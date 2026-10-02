import type { ConsoleCommand, ConsoleOpts } from "@overseer/protocol";

/**
 * Interactive `agent` — Cursor's own TUI. This passes no `--trust`/`--force`:
 * a human is watching, so the CLI's own trust dialog (it appears on an
 * untrusted cwd) is exactly what should happen here.
 *
 * `agent --resume` accepts an id it has never seen and starts that chat, so a
 * new session adopts the id Overseer minted the same way a resume names an
 * old one. Cursor has no hooks: activity comes from the server's output
 * heuristics.
 */

const CLI = "agent";

export async function consoleCommand(opts: ConsoleOpts): Promise<ConsoleCommand> {
  const args = opts.sessionId !== undefined ? ["--resume", opts.sessionId] : [];
  if (opts.prompt !== undefined) args.push("--", opts.prompt);
  return { file: CLI, args, cwd: opts.cwd };
}
