import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { DiscoveredProject } from "@overseer/protocol";

const run = promisify(execFile);

/**
 * The workspace root — the only surface shared with the host. A deployment
 * fact the container's mounts decide, so it is read from the environment and
 * never assumed by anything upstream of here.
 */
export const WORKSPACE_ROOT = process.env.OVERSEER_WORKSPACE ?? "/workspace";

/** Underscore-prefixed entries are the overseer's own staging area, not
 * projects — `/workspace/_overseer/` holds config import/export (webui design
 * doc §2). Not to be confused with `.overseer/` (docs/overseer.md §6.0). */
function isProjectCandidate(name: string): boolean {
  return !name.startsWith(".") && !name.startsWith("_");
}

/**
 * One level deep, by design: a project is a directory directly under the
 * workspace root with a `.git` in it. Recursing would turn every vendored
 * submodule and nested checkout into a "project" and make the panel useless.
 */
export async function scanWorkspace(
  root = WORKSPACE_ROOT,
): Promise<DiscoveredProject[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    // No workspace mount is a real state, not an error: a fresh instance with
    // nothing mounted has zero projects and the wizard says so.
    return [];
  }

  const projects: DiscoveredProject[] = [];
  for (const entry of entries) {
    // Follow symlinks: a symlinked project is a normal way to expose one repo.
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!isProjectCandidate(entry.name)) continue;

    const dir = path.join(root, entry.name);
    try {
      if (!(await stat(dir)).isDirectory()) continue;
      await stat(path.join(dir, ".git"));
    } catch {
      continue; // not a directory, or not a git project
    }

    projects.push({
      name: entry.name,
      path: dir,
      ...(await readGitState(dir)),
    });
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

/** Branch and dirtiness, or neither. Both stay undefined on failure rather
 * than defaulting — "clean" and "not determined" are different answers, and
 * only one of them is safe to show next to a branch name. */
async function readGitState(
  dir: string,
): Promise<{ gitBranch?: string; dirty?: boolean }> {
  try {
    const [branch, status] = await Promise.all([
      run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: dir,
        timeout: 5_000,
      }),
      run("git", ["status", "--porcelain"], { cwd: dir, timeout: 5_000 }),
    ]);
    return {
      gitBranch: branch.stdout.trim() || undefined,
      dirty: status.stdout.trim().length > 0,
    };
  } catch {
    return {};
  }
}
