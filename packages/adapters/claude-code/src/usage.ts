import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
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
 */

const CLI = "claude";
const run = promisify(execFile);

/** A hung `/usage` must not strand discovery or a login close. */
const USAGE_TIMEOUT_MS = 20_000;

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
 * Signed-out statuses do not carry usage, even if the caller passed some in.
 */
export async function withUsage(status: AdapterStatus): Promise<AdapterStatus> {
  if (!status.authenticated) {
    if (status.usage === undefined) return status;
    const { usage: _drop, ...rest } = status;
    return rest;
  }
  const usage = await readUsageWindows();
  if (usage.length === 0) return status;
  return { ...status, usage };
}

export async function readUsageWindows(): Promise<AdapterUsageWindow[]> {
  let stdout: string;
  try {
    const result = await run(
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
      { timeout: USAGE_TIMEOUT_MS, cwd: tmpdir() },
    );
    stdout = result.stdout;
  } catch (error) {
    const captured = (error as { stdout?: unknown }).stdout;
    if (typeof captured !== "string" || captured.trim() === "") return [];
    stdout = captured;
  }

  const report = extractReport(stdout);
  if (report === undefined) return [];
  return parseUsageReport(report);
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
