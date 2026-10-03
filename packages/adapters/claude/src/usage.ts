import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { AdapterStatus, AdapterUsageWindow } from "@overseer/protocol";

/**
 * Headless read of the CLI's subscription windows.
 *
 * `claude -p "/usage"` is not a published interface. The prompt, the JSON
 * envelope, and the prose inside `result` were captured from the pinned
 * 2.1.226 build (same as `login.ts`). A version bump can change any of them.
 * When it does, this module returns no windows rather than inventing a 0%
 * gauge the operator would read as empty.
 *
 * Asking costs nothing on that build (0 tokens, 0 turns, sub-second). Sessions
 * are not written (`--no-session-persistence`). Tools are disabled so a shape
 * change cannot start a real turn while we are only asking for a report.
 *
 * A hung Anthropic usage endpoint must not pin "retrieving usage…": we SIGTERM
 * the process group at the deadline, escalate to SIGKILL, and resolve empty
 * either way — even if the tree ignores signals. Node's `execFile({ timeout })`
 * alone is not enough.
 */

const CLI = "claude";

/** Default wall clock for one `/usage` ask. Tests may pass a shorter value. */
export const USAGE_TIMEOUT_MS = 20_000;

/** How long SIGTERM gets before SIGKILL — same rationale as login.ts. */
const KILL_GRACE_MS = 2_000;

const ANSI = /\x1b\[[0-9;]*m/g;

/**
 * `Current session: 16% used · resets Aug 14, 11:30pm (UTC)`
 * `Current session: 60% used · resets Aug 10 at 8:59pm (Asia/Seoul)`
 */
const SESSION_LINE =
  /^Current session:\s*(\d+(?:\.\d+)?)%\s*used(?:\s*[·•|]\s*resets\s+(.+))?$/i;

/**
 * `Current week (all models): 11% used · resets Aug 21, 3am (UTC)`
 * `Current week (Fable): 100% used · resets Aug 13 at 8am (Asia/Seoul)`
 */
const WEEK_LINE =
  /^Current week \(([^)]+)\):\s*(\d+(?:\.\d+)?)%\s*used(?:\s*[·•|]\s*resets\s+(.+))?$/i;

/** Strip the CLI's own words down to the windows the widget can draw. */
export function parseUsageReport(text: string): AdapterUsageWindow[] {
  const windows: AdapterUsageWindow[] = [];
  for (const raw of text.replace(ANSI, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;

    const session = SESSION_LINE.exec(line);
    if (session) {
      const window = toWindow("session", "session", session[1], session[2]);
      if (window) windows.push(window);
      continue;
    }

    const week = WEEK_LINE.exec(line);
    if (week) {
      const name = week[1]?.trim() ?? "";
      const allModels = name.toLowerCase() === "all models";
      const id = allModels ? "week" : `week:${slug(name)}`;
      const label = allModels ? "week" : name.toLowerCase();
      const window = toWindow(id, label, week[2], week[3]);
      if (window) windows.push(window);
    }
  }
  return windows;
}

/**
 * Attach the CLI's `/usage` windows to an auth status. Never throws, and never
 * lets a usage miss flip `authenticated`: the two questions fail separately.
 *
 * Signed-out statuses do not carry usage or `usageState`. Signed-in statuses
 * land on `ready` with windows, or `unavailable` when the report is empty,
 * times out, or cannot be parsed — never on a silent omission the widget would
 * read as "not asked yet".
 */
export async function withUsage(
  status: AdapterStatus,
  options?: { timeoutMs?: number; killGraceMs?: number },
): Promise<AdapterStatus> {
  if (!status.authenticated) {
    if (status.usage === undefined && status.usageState === undefined) {
      return status;
    }
    const { usage: _drop, usageState: _dropState, ...rest } = status;
    return rest;
  }
  const usage = await readUsageWindows(options);
  if (usage.length === 0) {
    const { usage: _drop, ...rest } = status;
    return { ...rest, usageState: "unavailable" };
  }
  return { ...status, usage, usageState: "ready" };
}

/** Auth-only status for a signed-in operator: usage will be asked separately. */
export function withPendingUsage(status: AdapterStatus): AdapterStatus {
  if (!status.authenticated) {
    if (status.usage === undefined && status.usageState === undefined) {
      return status;
    }
    const { usage: _drop, usageState: _dropState, ...rest } = status;
    return rest;
  }
  const { usage: _drop, ...rest } = status;
  return { ...rest, usageState: "pending" };
}

export async function readUsageWindows(options?: {
  timeoutMs?: number;
  killGraceMs?: number;
}): Promise<AdapterUsageWindow[]> {
  const timeoutMs = options?.timeoutMs ?? USAGE_TIMEOUT_MS;
  const killGraceMs = options?.killGraceMs ?? KILL_GRACE_MS;

  const stdout = await runUsageCli(timeoutMs, killGraceMs);
  const report = extractReport(stdout);
  if (report === undefined) return [];
  return parseUsageReport(report);
}

/**
 * Spawn `claude -p /usage` and always settle within timeout+grace: on success
 * with stdout, on timeout after killing the process group.
 */
function runUsageCli(timeoutMs: number, killGraceMs: number): Promise<string> {
  return new Promise((resolve) => {
    // Detached so the CLI and any children share a process group we can reap
    // when Anthropic's usage endpoint never answers.
    const child = spawn(
      CLI,
      [
        "-p",
        "/usage",
        "--output-format",
        "json",
        "--no-session-persistence",
        "--tools",
        "",
      ],
      {
        cwd: tmpdir(),
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
        // Do not wait on close — a wedged tree must not pin usageState pending.
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

function extractReport(stdout: string): string | undefined {
  const trimmed = stdout.trim();
  if (trimmed === "") return undefined;
  try {
    const parsed = JSON.parse(trimmed) as {
      is_error?: unknown;
      result?: unknown;
    };
    if (parsed.is_error === true) return undefined;
    if (typeof parsed.result === "string" && parsed.result.trim() !== "") {
      return parsed.result;
    }
    return undefined;
  } catch {
    // Text mode, or a build that wrapped the JSON. The parser no-ops on
    // anything that is not a Current session / Current week line.
    return trimmed;
  }
}

function toWindow(
  id: string,
  label: string,
  percent: string | undefined,
  resets: string | undefined,
): AdapterUsageWindow | undefined {
  if (percent === undefined) return undefined;
  const used = Number(percent) / 100;
  if (!Number.isFinite(used) || used < 0 || used > 1) return undefined;
  const phrase = resets?.trim();
  return phrase ? { id, label, used, resets: phrase } : { id, label, used };
}

function slug(value: string): string {
  const compact = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return compact === "" ? "other" : compact;
}
