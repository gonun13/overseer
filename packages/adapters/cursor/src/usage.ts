import { spawn } from "node:child_process";
import type { AdapterUsageCheck, AdapterUsageWindow } from "@overseer/protocol";
import { readDashboardUsage, type DashboardDeps } from "./usage-api.js";

/**
 * On-demand `checkUsage` for cursor, in two layers.
 *
 * 1. `usage-api.ts` reads the account's current period straight from the
 *    dashboard service with the token `agent login` stored — sub-second, free,
 *    the same numbers the CLI itself shows.
 * 2. Only when that comes back empty, the CLI is asked (`agent -p …`) — and
 *    the ask is a written brief with a JSON schema in it, not the bare string
 *    `/usage`.
 *
 * Why the second layer changed shape: `/usage` is not a client-intercepted
 * command here, the CLI hands the literal string to the model. That used to
 * produce a markdown write-up; verified live against 2026.09.02-c22c1a3 it now
 * produces a *refusal* ("`/usage` is built-in, run it interactively"), which
 * is why the widget went blank. Asked properly — told to fetch the real
 * figures and to answer in one fenced JSON block — the same CLI returns the
 * numbers again. That turn needs shell access (`--force`), and costs real
 * tokens (~100k observed) and real time (~160s observed), which is exactly why
 * it sits behind the direct read and is never scheduled.
 *
 * Reading the answer is layered the same way: the briefed JSON block first,
 * the older markdown-table parse second, prose with no gauges last. A shape
 * nobody anticipated costs the operator a gauge, never a wrong one.
 */

const CLI = "agent";

/**
 * The brief. Explicit about *fetching* — the model's first instinct now is to
 * send the operator to the dashboard — and explicit about the answer's shape,
 * so parsing reads a contract instead of guessing at prose.
 */
export const USAGE_PROMPT = `Report this Cursor account's current usage.

Get the real figures with the tools you have: read the local Cursor credentials (~/.config/cursor/auth.json) and POST them as a bearer token to https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage and .../GetPlanInfo. If those fail, find the figures another way. Do not guess, and do not tell me to look them up myself.

Answer with exactly one fenced json code block, in this shape:

\`\`\`json
{
  "plan": "Pro",
  "resets": "Oct 4, 2026",
  "spend": "$0.38",
  "pools": [
    { "label": "included", "used_percent": 1.9 },
    { "label": "auto", "used_percent": 0 },
    { "label": "api", "used_percent": 0.8 }
  ]
}
\`\`\`

used_percent is a number from 0 to 100. Use null for any field you could not determine, and [] for pools if you obtained no figures at all.`;

/** Generous: a real fetching turn was observed to take ~160s. */
export const USAGE_CHECK_TIMEOUT_MS = 240_000;

/** How long SIGTERM gets before SIGKILL — same rationale as login.ts. */
const KILL_GRACE_MS = 2_000;

// ---- reading gauges out of the model's write-up ---------------------------

/**
 * The fallback shape: prose a model wrote, not a fixed report, so this parses
 * the *form* it reached for — a markdown table of pools against percentages —
 * rather than any particular set of pool names. Captured live (Pro account,
 * 2026-09-02):
 *
 *   | Pool | Used | Status |
 *   |------|------|--------|
 *   | **Total** | 9.1% | $45.13 total ($20.00 included + $25.13 bonus) |
 *   | **Auto** | 0% | — |
 *   | **API (named models)** | **100%** | Limit reached |
 *
 * Everything here fails closed: a row without a clean percentage is not a
 * gauge, and a report with no such rows parses to nothing at all. The widget
 * then says it has no reading rather than drawing an empty 0% the operator
 * would read as "nothing used".
 */

/** A `| a | b | c |` row, captured without its outer pipes. */
const TABLE_ROW = /^\|(.+)\|\s*$/;
/** A cell that is *only* a percentage — `9.1%`, not `100% of $20`. */
const PERCENT_CELL = /^(\d+(?:\.\d+)?)\s*%$/;
/** A cell that is *only* an amount — `$45.13`, not `$45.13 total (…)`. */
const MONEY_CELL = /^\$\s?\d[\d,]*(?:\.\d+)?$/;
/** `**Billing cycle:** Aug 4 – Sep 4, 2026 (resets Sep 4)` */
const RESETS_PAREN = /\(\s*resets\s+([^)]{1,40}?)\s*\)/i;
/** A short line that is about the cycle, ending in when it turns over. */
const RESETS_LINE = /resets\s+(?:on\s+)?(.{1,40}?)[.\s]*$/i;

/** A table that is not a usage table must not flood a 252px instrument. */
const MAX_WINDOWS = 4;
/** Pool names are the model's words; keep them to a widget row's worth. */
const MAX_LABEL = 22;

function stripMarkup(cell: string): string {
  return cell.replace(/[*`]/g, "").trim();
}

/** The cells of one table row, or undefined when the line is not one. */
function rowCells(line: string): string[] | undefined {
  const match = TABLE_ROW.exec(line.trim());
  if (match?.[1] === undefined) return undefined;
  return match[1].split("|").map(stripMarkup);
}

/**
 * Read whatever gauges (and cycle spend) a markdown report exposes. Never
 * throws; an unreadable report is an empty `windows`, never an invented
 * reading.
 */
export function parseUsageReport(text: string): {
  windows: AdapterUsageWindow[];
  spend?: string;
} {
  const resets = readResets(text);
  const windows: AdapterUsageWindow[] = [];
  const seen = new Set<string>();
  let spend: string | undefined;

  for (const line of text.split(/\r?\n/)) {
    const cells = rowCells(line);
    if (cells === undefined || cells.length < 2) continue;

    const label = cells[0] ?? "";
    // Header (`Pool`) carries no percentage and falls out on its own; the
    // `|---|---|` separator would otherwise read as a pool named "---".
    if (label === "" || /^:?-{2,}:?$/.test(label)) continue;
    const values = cells.slice(1);

    const percent = values.find((cell) => PERCENT_CELL.test(cell));
    if (percent !== undefined && windows.length < MAX_WINDOWS) {
      const used = Number(PERCENT_CELL.exec(percent)?.[1]) / 100;
      const id = slug(label);
      if (Number.isFinite(used) && used >= 0 && used <= 1 && !seen.has(id)) {
        seen.add(id);
        windows.push({
          id,
          label: shorten(label),
          used,
          ...(resets !== undefined ? { resets } : {}),
        });
      }
    }

    // The spend table's own total — `| **Total** | **$45.13** |`. The pools
    // table has a Total row too, but its amount cell carries a whole clause
    // after the figure, so MONEY_CELL declines it.
    if (/^total$/i.test(label)) {
      const money = values.find((cell) => MONEY_CELL.test(cell));
      if (money !== undefined) spend = money;
    }
  }

  return spend !== undefined ? { windows, spend } : { windows };
}

function readResets(text: string): string | undefined {
  const parenthesised = RESETS_PAREN.exec(text);
  if (parenthesised?.[1] !== undefined) return parenthesised[1];

  // Only short lines that are *about* the cycle — a paragraph of prose
  // mentioning a reset must not have its tail read as a date.
  for (const raw of text.split(/\r?\n/)) {
    const line = stripMarkup(raw);
    if (line.length > 80) continue;
    if (!/cycle|renews|resets/i.test(line)) continue;
    const match = RESETS_LINE.exec(line);
    if (match?.[1] !== undefined && match[1].trim() !== "") {
      return match[1].trim();
    }
  }
  return undefined;
}

function shorten(label: string): string {
  const lower = label.toLowerCase();
  return lower.length <= MAX_LABEL ? lower : `${lower.slice(0, MAX_LABEL - 1)}…`;
}

function slug(value: string): string {
  const compact = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return compact === "" ? "pool" : compact;
}

// ---- reading the answer the brief asked for -------------------------------

/** A reply big enough to hide a report in, but not a whole transcript. */
const MAX_SPANS = 40;

/**
 * Pull the briefed object out of the model's reply. The reply is never only
 * that object — the CLI prepends the model's narration of its own tool calls,
 * and the fence is only *usually* there — so this scans for balanced `{…}`
 * spans and takes the first that parses and carries a `pools` array, the
 * field the brief made the contract.
 */
export function parseStructuredUsage(text: string):
  | {
      windows: AdapterUsageWindow[];
      spend?: string;
    }
  | undefined {
  for (const candidate of jsonSpans(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const pools = (parsed as { pools?: unknown }).pools;
    if (!Array.isArray(pools)) continue;

    const resets = readString((parsed as { resets?: unknown }).resets);
    const windows: AdapterUsageWindow[] = [];
    const seen = new Set<string>();
    for (const entry of pools) {
      if (windows.length >= MAX_WINDOWS) break;
      if (typeof entry !== "object" || entry === null) continue;
      const label = readString((entry as { label?: unknown }).label);
      const percent = readNumber(
        (entry as { used_percent?: unknown }).used_percent,
      );
      if (label === undefined || percent === undefined) continue;
      if (percent < 0 || percent > 100) continue;
      const id = slug(label);
      if (seen.has(id)) continue;
      seen.add(id);
      windows.push({
        id,
        label: shorten(label),
        used: percent / 100,
        ...(resets !== undefined ? { resets } : {}),
      });
    }

    // An object in the briefed shape that yielded nothing is still an answer:
    // no gauges is the honest outcome, and falling through to the markdown
    // parse would only re-read the same figures the model already declined to
    // give.
    const spend = readString((parsed as { spend?: unknown }).spend);
    return spend !== undefined ? { windows, spend } : { windows };
  }
  return undefined;
}

/** Every balanced `{…}` span in the text, outermost first. */
function jsonSpans(text: string): string[] {
  const spans: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j += 1) {
      const char = text[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          spans.push(text.slice(i, j + 1));
          i = j; // Past this object; nested ones ride along inside it.
          break;
        }
      }
    }
    if (spans.length >= MAX_SPANS) break;
  }
  return spans;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/%$/, "").trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * The whole ladder for one CLI answer: the briefed JSON, then the markdown
 * table an older CLI wrote, then nothing.
 */
export function readUsageAnswer(text: string): {
  windows: AdapterUsageWindow[];
  spend?: string;
} {
  return parseStructuredUsage(text) ?? parseUsageReport(text);
}

export async function checkUsage(opts: {
  projectDir: string;
  timeoutMs?: number;
  killGraceMs?: number;
  /** Test seam for the direct read; `false` skips it and asks the CLI. */
  dashboard?: DashboardDeps | false;
}): Promise<AdapterUsageCheck> {
  if (opts.dashboard !== false) {
    // A surprise here (DNS down, a thrown fetch) must not cost the operator
    // the CLI fallback.
    let direct;
    try {
      direct = await readDashboardUsage(opts.dashboard ?? {});
    } catch {
      direct = undefined;
    }
    if (direct !== undefined && direct.windows.length > 0) {
      return {
        ok: true,
        report: direct.report,
        windows: direct.windows,
        ...(direct.spend !== undefined ? { spend: direct.spend } : {}),
      };
    }
  }

  const timeoutMs = opts.timeoutMs ?? USAGE_CHECK_TIMEOUT_MS;
  const killGraceMs = opts.killGraceMs ?? KILL_GRACE_MS;

  const stdout = await runUsageCli(opts.projectDir, timeoutMs, killGraceMs);
  return extractReport(stdout);
}

/**
 * Spawn the briefed CLI turn and always settle within timeout+grace: on
 * success with stdout, on timeout after killing the process group.
 *
 * `--force` is what makes this layer work at all: the figures sit behind a
 * credential read and an HTTPS call, and without it the model declines those
 * tool calls and writes a report with no numbers in it. `--trust` keeps the
 * workspace-trust dialog from hanging a headless run forever.
 */
function runUsageCli(
  projectDir: string,
  timeoutMs: number,
  killGraceMs: number,
): Promise<string> {
  return new Promise((resolve) => {
    // Detached so the CLI and any children share a process group we can reap
    // if the ask never settles.
    const child = spawn(
      CLI,
      [
        "-p",
        USAGE_PROMPT,
        "--output-format",
        "json",
        "--trust",
        "--force",
      ],
      {
        cwd: projectDir,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (out: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(absolute);
      if (killTimer !== undefined) clearTimeout(killTimer);
      resolve(out);
    };

    const signalTree = (signal: NodeJS.Signals) => {
      const pid = child.pid;
      if (pid === undefined) return;
      try {
        // Negative pid = whole process group (detached spawn).
        process.kill(-pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* already gone */
        }
      }
    };

    const escalate = () => {
      signalTree("SIGTERM");
      if (killTimer !== undefined) return;
      killTimer = setTimeout(() => {
        signalTree("SIGKILL");
        // Do not wait on close — a wedged tree must not pin the ask forever.
        finish(stdout);
      }, killGraceMs);
    };

    const deadline = setTimeout(escalate, timeoutMs);
    // Absolute ceiling if even SIGKILL / close handling misbehaves.
    const absolute = setTimeout(
      () => finish(stdout),
      timeoutMs + killGraceMs + 500,
    );

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    // Drain stderr so a full pipe cannot stall the child.
    child.stderr?.on("data", () => {});
    child.on("error", () => finish(""));
    child.on("close", () => finish(stdout));
  });
}

/**
 * The `{type:"result", is_error, result}` envelope, found rather than assumed:
 * the CLI has been seen to put trace lines on stdout alongside it, and
 * `--output-format json` is one object today but was NDJSON in stream mode
 * yesterday. So every balanced object on stdout is a candidate and the last
 * one carrying a `result` wins.
 */
function readEnvelope(
  stdout: string,
): { isError: boolean; result?: string } | undefined {
  let found: { isError: boolean; result?: string } | undefined;
  for (const span of jsonSpans(stdout)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(span);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const envelope = parsed as { is_error?: unknown; result?: unknown };
    if (!("result" in envelope) && !("is_error" in envelope)) continue;
    found = {
      isError: envelope.is_error === true,
      ...(typeof envelope.result === "string"
        ? { result: envelope.result }
        : {}),
    };
  }
  return found;
}

function extractReport(stdout: string): AdapterUsageCheck {
  if (stdout.trim() === "") {
    return { ok: false, reason: "agent did not answer" };
  }
  const envelope = readEnvelope(stdout);
  if (envelope === undefined) {
    return { ok: false, reason: "could not read agent's usage output" };
  }
  if (envelope.isError) {
    return {
      ok: false,
      reason:
        envelope.result !== undefined && envelope.result.trim() !== ""
          ? envelope.result
          : "agent reported an error",
    };
  }
  if (envelope.result !== undefined && envelope.result.trim() !== "") {
    // An answer that defeats both parsers is still worth returning: the prose
    // is the operator's answer even when no gauge can be drawn from it.
    const { windows, spend } = readUsageAnswer(envelope.result);
    return {
      ok: true,
      report: envelope.result,
      windows,
      ...(spend !== undefined ? { spend } : {}),
    };
  }
  return { ok: false, reason: "agent returned no usage report" };
}
