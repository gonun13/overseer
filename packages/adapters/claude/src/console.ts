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
const HOOK_EVENTS: Array<{
  event: string;
  matcher?: string;
  activity: string;
}> = [
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
 * What an agent is told about the others (spec/behaviour/relay.md §5.1),
 * appended to Claude Code's own system prompt rather than replacing it.
 */
export function relayBrief(callsign: string): string {
  return [
    `You are ${callsign}, one of several coding agents the operator runs side by side in Overseer.`,
    "`overseer who` lists the other agents, their projects and what they are on;",
    "`overseer tell <name> <message>` sends one of them a prompt, delivered when it is idle.",
    "A prompt starting `[from <name>]` was relayed by that agent, not typed by the operator.",
    "Relay only when the operator's task calls for it; relays are rate-limited.",
  ].join(" ");
}

/**
 * A relay, typed into the TUI as one submitted prompt: a bracketed paste, so
 * newlines inside it stay in the prompt instead of submitting it early, then
 * Enter. Paste markers inside the text are stripped — they would end the
 * paste partway.
 */
export function relayInput(text: string): string {
  const clean = text.replace(/\x1b\[20[01]~/g, "");
  return `\x1b[200~${clean}\x1b[201~\r`;
}

/**
 * Before spawn we mark interactive onboarding complete so the TUI does not
 * re-ask for a browser login the pipe-based auth flow already finished.
 */
export async function consoleCommand(
  opts: ConsoleOpts,
): Promise<ConsoleCommand> {
  await ensureInteractiveReady(opts.cwd);

  const args: string[] = [];
  if (opts.sessionId !== undefined) {
    args.push(
      opts.resume === true ? "--resume" : "--session-id",
      opts.sessionId,
    );
  }
  if (opts.hookUrl !== undefined) {
    args.push("--settings", hookSettings(opts.hookUrl));
  }
  if (opts.callsign !== undefined) {
    args.push("--append-system-prompt", relayBrief(opts.callsign));
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
