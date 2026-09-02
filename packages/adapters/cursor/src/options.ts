import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PermissionMode, ProviderOption, ProviderOptions } from "@overseer/protocol";

/**
 * What this CLI offers a session: models and permission modes. Verified
 * against `agent 2026.08.31-4057e58`.
 *
 * Unlike claude-code's `initialize` control request, `agent models` is a
 * plain synchronous command — it prints and exits on its own, no reap
 * dance needed (nothing waits for a turn that never comes).
 */

const CLI = "agent";

export const OPTIONS_TIMEOUT_MS = 10_000;

/**
 * Cursor's own three read/print-relevant modes. `--force`/`--yolo` and
 * `--auto-review` are single boolean flags in the CLI's own vocabulary, not
 * named "modes" the way `--mode plan`/`--mode ask` are — this adapter always
 * passes `--force --trust` regardless (there is no interactive approval
 * loop under `--print` to defer to; capabilities.permissionPrompts is
 * false), so only the two read-only variants are offered as a distinct
 * choice. `detail` is Overseer's own gloss — the CLI ships no descriptions.
 */
const PERMISSION_MODES: ProviderOption[] = [
  { value: "", label: "default", detail: "full edit and shell access" },
  { value: "plan", label: "plan", detail: "read-only — analyze and propose, no edits" },
  { value: "ask", label: "ask", detail: "Q&A only — no tool execution" },
];

export function normalizePermissionMode(value: unknown): PermissionMode | undefined {
  if (typeof value !== "string") return undefined;
  return value === "plan" || value === "ask" ? (value as PermissionMode) : undefined;
}

/** Parse `agent models`' plain-text listing:
 *
 *   Available models
 *
 *   auto - Auto (current, default)
 *   gpt-5.3-codex-low - Codex 5.3 Low
 *   ...
 *
 * one `<id> - <label>` per line. The marker on the row a turn with no
 * `--model` would actually run on has **two verified forms**: a never-
 * touched account marks it `(current, default)`, but the moment the
 * operator (or this adapter's own `--model`) picks something else, that
 * choice persists as the account's new selection and the marker on it
 * becomes `(current)` alone — verified live: switching to
 * `gpt-5.3-codex-low` for one turn left a *different* row,
 * `gpt-5.3-codex`, marked plain `(current)` on the next `agent models`.
 * Both mean the same thing for `defaultModel`'s documented purpose ("what
 * the next turn runs on if nothing is passed"), so both are matched.
 */
export function parseModelsOutput(stdout: string): {
  models: ProviderOption[];
  defaultModel?: string;
} {
  const CURRENT = /\(current(?:, default)?\)/;
  const models: ProviderOption[] = [];
  let defaultModel: string | undefined;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const match = /^(\S+)\s+-\s+(.+)$/.exec(line);
    if (match === null) continue;
    const [, value, rest] = match as unknown as [string, string, string];
    const isCurrent = CURRENT.test(rest);
    const label = rest.replace(new RegExp(`\\s*${CURRENT.source}\\s*`), "").trim();
    models.push({ value, label: label === "" ? value : label });
    if (isCurrent) defaultModel = value;
  }
  return { models, ...(defaultModel !== undefined ? { defaultModel } : {}) };
}

async function runModels(
  projectDir: string,
  timeoutMs: number,
): Promise<{ models: ProviderOption[]; defaultModel?: string }> {
  const run = promisify(execFile);
  try {
    const { stdout } = await run(CLI, ["models"], { cwd: projectDir, timeout: timeoutMs });
    return parseModelsOutput(stdout);
  } catch {
    return { models: [] };
  }
}

export async function readProviderOptions(
  opts: { projectDir: string },
  options?: { timeoutMs?: number },
): Promise<ProviderOptions> {
  const timeoutMs = options?.timeoutMs ?? OPTIONS_TIMEOUT_MS;
  const probe = await runModels(opts.projectDir, timeoutMs);

  return {
    models: probe.models,
    permissionModes: PERMISSION_MODES,
    // No `--agent` flag exists to force one at session-spawn time (unlike
    // claude's), so a list here would name rows nothing here could act on —
    // "report nothing rather than a guess".
    agents: [],
    ...(probe.defaultModel !== undefined ? { defaultModel: probe.defaultModel } : {}),
  };
}
