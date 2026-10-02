import type { ConsoleCommand, ConsoleOpts } from "@overseer/protocol";
import { ensureInteractiveReady } from "./interactive-ready.js";

/**
 * Interactive `claude` — the CLI's own TUI, slash commands and all. Overseer
 * neither parses the output nor rewrites input; the server spawns this command
 * line in a PTY and the operator drives it directly.
 */

const CLI = "claude";

/**
 * Claude Code hook events, and the activity each one means. `Notification`
 * is narrowed to permission prompts: the idle-prompt notification fires a
 * minute after a turn already ended, and is not news.
 */
const HOOK_EVENTS: Array<{ event: string; matcher?: string; activity: string }> = [
  { event: "SessionStart", activity: "idle" },
  { event: "UserPromptSubmit", activity: "working" },
  { event: "PreToolUse", matcher: "*", activity: "working" },
  { event: "PostToolUse", matcher: "*", activity: "working" },
  { event: "Notification", matcher: "permission_prompt", activity: "waiting" },
  { event: "Notification", matcher: "elicitation_dialog", activity: "waiting" },
  { event: "Stop", activity: "idle" },
];

/**
 * A `--settings` layer that reports lifecycle events to Overseer. It is
 * passed on the command line, so it merges with — never replaces — the
 * operator's own user/project settings and hooks. Each hook is a fire-and-
 * forget `curl` with a short timeout that can never fail the CLI's turn.
 */
export function hookSettings(hookUrl: string): string {
  const hooks: Record<string, Array<Record<string, unknown>>> = {};
  for (const { event, matcher, activity } of HOOK_EVENTS) {
    const url = `${hookUrl}?activity=${activity}`;
    const command = `curl -s -m 2 -o /dev/null -X POST '${url}' || true`;
    (hooks[event] ??= []).push({
      ...(matcher !== undefined ? { matcher } : {}),
      hooks: [{ type: "command", command, timeout: 5 }],
    });
  }
  return JSON.stringify({ hooks });
}

/**
 * Before spawn we mark interactive onboarding complete so the TUI does not
 * re-ask for a browser login the pipe-based auth flow already finished.
 */
export async function consoleCommand(opts: ConsoleOpts): Promise<ConsoleCommand> {
  await ensureInteractiveReady(opts.cwd);

  const args: string[] = [];
  if (opts.sessionId !== undefined) {
    args.push(opts.resume === true ? "--resume" : "--session-id", opts.sessionId);
  }
  if (opts.hookUrl !== undefined) {
    args.push("--settings", hookSettings(opts.hookUrl));
  }
  // After `--`, so a prompt that starts with a dash is still a prompt.
  if (opts.prompt !== undefined) args.push("--", opts.prompt);

  return {
    file: CLI,
    args,
    cwd: opts.cwd,
    env: {
      // Container has no GUI; if the CLI still tries to open a browser, sink it.
      BROWSER: process.env.BROWSER ?? "/bin/true",
      // CLI is image-pinned and installed as root; the `node` user cannot
      // write the npm prefix, so auto-update would only spam the TUI with a
      // permission error. Version bumps go through the Dockerfile pin.
      DISABLE_AUTOUPDATER: process.env.DISABLE_AUTOUPDATER ?? "1",
      // Harder lock: skip manual `claude update` paths too (same pin reason).
      DISABLE_UPDATES: process.env.DISABLE_UPDATES ?? "1",
    },
    hooked: opts.hookUrl !== undefined,
  };
}
