import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { WORKSPACE_ROOT } from "../../workspace.js";
import { recordAction } from "../internal.js";

const run = promisify(execFile);

export const PERSONALITY_PROJECT = "overseer-personality";
export const PERSONALITY_CONFIG = "personality.json";

export function personalityDir(root = WORKSPACE_ROOT): string {
  return path.join(root, PERSONALITY_PROJECT);
}

export function personalityConfigPath(root = WORKSPACE_ROOT): string {
  return path.join(personalityDir(root), PERSONALITY_CONFIG);
}

/** Whether the personality project directory exists (scaffold may still be needed). */
export async function personalityExists(root = WORKSPACE_ROOT): Promise<boolean> {
  try {
    await access(personalityDir(root));
    return true;
  } catch {
    return false;
  }
}

/** Whether `personality.json` is present — the file the overseer actually tracks. */
export async function personalityConfigExists(
  root = WORKSPACE_ROOT,
): Promise<boolean> {
  try {
    await access(personalityConfigPath(root));
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the personality project if absent. Returns true when this call
 * created it. Exported so discovery can show scaffold as its own step.
 */
export async function scaffoldPersonality(
  root = WORKSPACE_ROOT,
): Promise<boolean> {
  return ensureScaffold(root);
}

/**
 * Create the project / `personality.json` if absent. Idempotent: an existing
 * config is never clobbered. If the directory is there but the file is gone,
 * only the defaults file is rewritten (and committed when git is present).
 * Live deletion is handled by the workspace monitor (complain + ask for
 * restart); discovery on the next boot calls this again to restore.
 */
export async function ensureScaffold(root: string): Promise<boolean> {
  const dir = personalityDir(root);
  const config = personalityConfigPath(root);

  const dirPresent = await access(dir).then(
    () => true,
    () => false,
  );
  const configPresent = await access(config).then(
    () => true,
    () => false,
  );
  if (dirPresent && configPresent) return false;

  try {
    if (!dirPresent) {
      await mkdir(dir, { recursive: true });
      await writeFile(config, SCAFFOLD_CONFIG, "utf8");
      await writeFile(path.join(dir, "README.md"), SCAFFOLD_README, "utf8");

      // A real git project, so it is discovered by the ordinary scanner and shows
      // up in the project panel with no special-casing anywhere in the UI.
      // -b main: don't inherit whatever init.defaultBranch happens to be, and
      // don't emit git's "using master" advice into the scaffold path.
      await run("git", ["init", "-q", "-b", "main"], { cwd: dir, timeout: 10_000 });
      await run("git", ["add", "-A"], { cwd: dir, timeout: 10_000 });
      await run(
        "git",
        [
          "-c",
          "user.email=overseer@localhost",
          "-c",
          "user.name=overseer",
          "commit",
          "-q",
          "-m",
          "scaffold overseer-personality",
        ],
        { cwd: dir, timeout: 10_000 },
      );
    } else {
      // Directory survived; only the tracked config was deleted.
      await writeFile(config, SCAFFOLD_CONFIG, "utf8");
      try {
        await access(path.join(dir, ".git"));
        await run("git", ["add", PERSONALITY_CONFIG], {
          cwd: dir,
          timeout: 10_000,
        });
        await run(
          "git",
          [
            "-c",
            "user.email=overseer@localhost",
            "-c",
            "user.name=overseer",
            "commit",
            "-q",
            "-m",
            "restore personality defaults",
          ],
          { cwd: dir, timeout: 10_000 },
        );
      } catch {
        // Not a git repo (or commit failed) — the file on disk is what matters.
      }
    }

    await recordAction({
      actor: "overseer",
      action: "personality:scaffold",
      outcome: "ok",
      detail: config,
    });
    return true;
  } catch (error) {
    await recordAction({
      actor: "overseer",
      action: "personality:scaffold",
      outcome: "failed",
      detail: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export const SCAFFOLD_CONFIG = `{
  "// what this is": "Advisory input to the overseer. Internal memory always wins.",
  "// customizable": "tone, name, greeting, typingChance · and nothing else.",
  "// rejected fields": "are reported back to you as a signal, never dropped silently."
}
`;

const SCAFFOLD_README = `# overseer-personality

This is the overseer's **external memory** — the part of it you can shape.

It is an ordinary git project under the workspace mount, so you can edit it three
ways: directly on the host, through a session opened against it, or via the
async side-task editing flow used for skills and subagents.

## What you can change

Edit \`personality.json\`:

| Field          | Values                                       |
| -------------- | -------------------------------------------- |
| \`tone\`         | \`neutral\` · \`dry\` · \`warm\`                    |
| \`name\`         | what the overseer calls you (≤ 24 chars)      |
| \`greeting\`     | replaces the welcome headline (≤ 48 chars)    |
| \`typingChance\` | 0–0.5, how often the headline types out       |

## What you cannot change, and why

This project is **advisory**. Internal memory — the overseer's own logs, action
register and state, which live inside the container and are not reachable from
here — always takes precedence.

Anything that would disable logging, filter the action register, grant
permissions, change paths or mounts, or override how signals are ranked is
refused. So is any field not in the table above; unknown fields are rejected by
default rather than ignored.

Nothing is dropped quietly. A refused field shows up in the overseer space as a
signal naming the field and the reason, so you always know what did and did not
take effect.

See \`docs/overseer.md\` §6 in the overseer repo for the full model.
`;
