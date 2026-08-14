import { homedir } from "node:os";
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

/**
 * Claude's interactive TUI gates on `hasCompletedOnboarding` in its config
 * JSON — separately from whether `claude auth status` reports signed-in.
 *
 * Overseer logs in via `claude auth login` under plain pipes. That writes
 * credentials the status check can see, but does **not** flip the interactive
 * onboarding flag. Spawning a raw PTY then hits the theme picker and a second
 * browser login even though the container is already signed in.
 *
 * This module only ever sets the onboarding / trust booleans. It never reads
 * or logs credential fields.
 */

function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude");
}

function configPath(): string {
  return path.join(configDir(), ".claude.json");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Mark interactive onboarding complete and trust `cwd` so OPEN CONSOLE lands
 * in the REPL with the credentials already on disk, not a second OAuth dance.
 */
export async function ensureInteractiveReady(cwd?: string): Promise<void> {
  const file = configPath();
  await mkdir(configDir(), { recursive: true });

  let current: Record<string, unknown> = {};
  try {
    const raw = await readFile(file, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isPlainObject(parsed)) current = parsed;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code !== "ENOENT") {
      // Corrupt / unreadable config: start from a blank object rather than
      // refuse the console — credentials live in a sibling file.
      current = {};
    }
  }

  let changed = false;
  if (current.hasCompletedOnboarding !== true) {
    current.hasCompletedOnboarding = true;
    changed = true;
  }

  if (cwd !== undefined && cwd.length > 0) {
    const projects = isPlainObject(current.projects)
      ? { ...current.projects }
      : {};
    const existing = isPlainObject(projects[cwd])
      ? { ...projects[cwd] }
      : {};
    if (existing.hasTrustDialogAccepted !== true) {
      existing.hasTrustDialogAccepted = true;
      projects[cwd] = existing;
      current.projects = projects;
      changed = true;
    }
  }

  if (!changed) return;

  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(current, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tmp, file);
}
