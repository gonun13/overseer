import { spawn } from "node:child_process";
import type { AdapterUsageCheck, AdapterUsageWindow } from "@overseer/protocol";

/**
 * On-demand `checkUsage`: `agent -p "/usage"`.
 *
 * Unlike claude-code's `/usage`, this is not a client-intercepted command —
 * verified live (2026.08.31-4057e58): the CLI hands the literal string
 * `/usage` to the model as an ordinary prompt, which then reasons about what
 * it means, tries to fetch account usage, and writes up a markdown report.
 * Real tokens (~37k observed), real latency (~46s observed), and no
 * guaranteed shape — so this is never scheduled automatically and the result
 * is shown as-is rather than parsed into `AdapterUsageWindow` gauges.
 *
 * No `--force`: an unattended tool call (e.g. shell access to fetch live
 * usage) is left for the CLI to refuse on its own rather than granted wholesale
 * for a read-only ask — observed live, it falls back to cached/local data and
 * still produces a report. `--trust` alone avoids the workspace trust dialog,
 * which would otherwise hang a headless run forever.
 */

const CLI = "agent";

/** Generous: a real run was observed to take ~46s. */
export const USAGE_CHECK_TIMEOUT_MS = 120_000;

/** How long SIGTERM gets before SIGKILL — same rationale as login.ts. */
const KILL_GRACE_MS = 2_000;

// ---- reading gauges out of the model's write-up ---------------------------

/**
 * The report is prose a model wrote, not a fixed report, so this parses the
 * *form* it reached for — a markdown table of pools against percentages —
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
 * Read whatever gauges (and cycle spend) the report exposes. Never throws;
 * an unreadable report is an empty `windows`, never an invented reading.
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

export async function checkUsage(opts: {
  projectDir: string;
  timeoutMs?: number;
  killGraceMs?: number;
}): Promise<AdapterUsageCheck> {
  const timeoutMs = opts.timeoutMs ?? USAGE_CHECK_TIMEOUT_MS;
  const killGraceMs = opts.killGraceMs ?? KILL_GRACE_MS;

  const stdout = await runUsageCli(opts.projectDir, timeoutMs, killGraceMs);
  return extractReport(stdout);
}

/**
 * Spawn `agent -p "/usage"` and always settle within timeout+grace: on
 * success with stdout, on timeout after killing the process group.
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
      ["-p", "/usage", "--output-format", "json", "--trust"],
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

function extractReport(stdout: string): AdapterUsageCheck {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    return { ok: false, reason: "agent did not answer" };
  }
  let parsed: { is_error?: unknown; result?: unknown };
  try {
    parsed = JSON.parse(trimmed) as typeof parsed;
  } catch {
    return { ok: false, reason: "could not read agent's usage output" };
  }
  if (parsed.is_error === true) {
    return {
      ok: false,
      reason:
        typeof parsed.result === "string" && parsed.result.trim() !== ""
          ? parsed.result
          : "agent reported an error",
    };
  }
  if (typeof parsed.result === "string" && parsed.result.trim() !== "") {
    // A report that defeats the parser is still worth returning: the prose is
    // the operator's answer even when no gauge can be drawn from it.
    const { windows, spend } = parseUsageReport(parsed.result);
    return {
      ok: true,
      report: parsed.result,
      windows,
      ...(spend !== undefined ? { spend } : {}),
    };
  }
  return { ok: false, reason: "agent returned no usage report" };
}
