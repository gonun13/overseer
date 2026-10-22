import { execFile } from "node:child_process";

/**
 * Every short `opencode` subcommand this adapter runs, in one place. Captured
 * against the pinned build (`opencode-ai@1.19.4`, the manifest's pin), not a
 * published contract:
 *
 *   opencode --version          → `1.19.4`
 *   opencode models             → one `<provider>/<model>` per line, only for
 *                                 providers that can answer right now — the
 *                                 free `opencode/*` models with no credential
 *   opencode session delete <id> → exit 0, or exit 1 with "Session not found"
 *
 * Output is never logged: a model list is harmless, but this module does not
 * get to decide that for whatever the next subcommand prints.
 */

export const CLI = "opencode";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CliRunner = (
  args: string[],
  opts: { cwd?: string; timeoutMs: number },
) => Promise<CliResult>;

/** The environment every opencode child gets. The npm prefix is root-owned,
 * so a self-update could only fail; version bumps go through the manifest. */
export function opencodeEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...base, OPENCODE_DISABLE_AUTOUPDATE: "1" };
}

export function cliRunner(env: NodeJS.ProcessEnv = process.env): CliRunner {
  return (args, opts) =>
    new Promise((resolve) => {
      execFile(
        CLI,
        args,
        {
          cwd: opts.cwd,
          env: opencodeEnv(env),
          timeout: opts.timeoutMs,
          maxBuffer: 4 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          // A missing binary or a deadline carries no numeric exit code.
          const exit: unknown = error?.code;
          const code =
            error === null ? 0 : typeof exit === "number" ? exit : -1;
          resolve({ code, stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
}

/** Provider ids that `opencode models` lists at least one model for. */
export function connectedProviders(modelsOutput: string): string[] {
  const providers = new Set<string>();
  for (const line of modelsOutput.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9._-]+)\/\S+$/.exec(line.trim());
    if (match) providers.add(match[1]!);
  }
  return [...providers];
}
