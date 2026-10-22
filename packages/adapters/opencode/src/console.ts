import type { ConsoleCommand, ConsoleOpts } from "@overseer/protocol";
import { CLI } from "./cli.js";

/**
 * Interactive `opencode` — its own TUI, `/connect`, agents, models and
 * permission prompts included. Overseer passes a session and a plugin, and
 * otherwise leaves the command line alone.
 *
 * Verified against the pinned 1.19.4 in a PTY:
 *
 * - `--session <id>` opens an existing session; it does not adopt an unseen
 *   id, which is why new sessions are created first (sessions.ts).
 * - `--prompt <text>` submits on a fresh TUI but is ignored next to
 *   `--session`, so the opening prompt of a prepared session is sent by the
 *   plugin instead (plugin.ts).
 * - A bracketed paste followed by Enter submits one prompt, newlines kept.
 * - An idle TUI writes nothing, so the output heuristic would also work; the
 *   plugin is what tells a permission prompt (`waiting`) from a turn.
 */

/** Where the plugin lands after `tsc` — beside this file in `dist/`. */
export const PLUGIN_URL = new URL("./plugin.js", import.meta.url).href;

/** What the plugin reads, named once for both sides. */
export const PLUGIN_ENV = {
  hookUrl: "OVERSEER_OPENCODE_HOOK_URL",
  brief: "OVERSEER_OPENCODE_BRIEF",
  session: "OVERSEER_OPENCODE_SESSION",
  prompt: "OVERSEER_OPENCODE_PROMPT",
} as const;

/**
 * What an agent is told about the others (spec/behaviour/relay.md §5.1),
 * appended to opencode's system prompt by the plugin.
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

/** One submitted prompt: a bracketed paste, then Enter. Paste markers inside
 * the text are stripped — they would end the paste partway. */
export function relayInput(text: string): string {
  const clean = text.replace(/\x1b\[20[01]~/g, "");
  return `\x1b[200~${clean}\x1b[201~\r`;
}

export async function consoleCommand(
  opts: ConsoleOpts,
): Promise<ConsoleCommand> {
  const args: string[] = [];
  const env: Record<string, string> = {
    // The npm prefix is root-owned: an in-TUI update could only fail, and a
    // version bump goes through the manifest pin.
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    // Merged over the operator's own config, whose plugins still load.
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [PLUGIN_URL] }),
  };
  if (opts.sessionId !== undefined) {
    args.push("--session", opts.sessionId);
    if (opts.prompt !== undefined && opts.resume !== true) {
      env[PLUGIN_ENV.session] = opts.sessionId;
      env[PLUGIN_ENV.prompt] = opts.prompt;
    }
  } else if (opts.prompt !== undefined) {
    args.push("--prompt", opts.prompt);
  }
  if (opts.hookUrl !== undefined) env[PLUGIN_ENV.hookUrl] = opts.hookUrl;
  if (opts.callsign !== undefined)
    env[PLUGIN_ENV.brief] = relayBrief(opts.callsign);
  return {
    file: CLI,
    args,
    cwd: opts.cwd,
    env,
    hooked: opts.hookUrl !== undefined,
  };
}
