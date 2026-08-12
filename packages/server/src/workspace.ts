import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  DiscoveredProject,
  UntrackedFolder,
} from "@overseer/protocol";

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

export interface WorkspaceScan {
  projects: DiscoveredProject[];
  /** Visible folders that are not git projects — signalled, not listed. */
  untracked: UntrackedFolder[];
}

/**
 * One level deep, by design: a project is a directory directly under the
 * workspace root with a `.git` in it. Recursing would turn every vendored
 * submodule and nested checkout into a "project" and make the panel useless.
 *
 * Non-git folders are returned separately so the overseer can signal them
 * instead of silently ignoring a directory the operator just created.
 */
export async function scanWorkspace(
  root = WORKSPACE_ROOT,
): Promise<WorkspaceScan> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    // No workspace mount is a real state, not an error: a fresh instance with
    // nothing mounted has zero projects and the wizard says so.
    return { projects: [], untracked: [] };
  }

  const projects: DiscoveredProject[] = [];
  const untracked: UntrackedFolder[] = [];
  for (const entry of entries) {
    // Follow symlinks: a symlinked project is a normal way to expose one repo.
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!isProjectCandidate(entry.name)) continue;

    const dir = path.join(root, entry.name);
    try {
      if (!(await stat(dir)).isDirectory()) continue;
    } catch {
      continue;
    }

    try {
      await stat(path.join(dir, ".git"));
    } catch {
      untracked.push({ name: entry.name, path: dir });
      continue;
    }

    projects.push({
      name: entry.name,
      path: dir,
      ...(await readGitState(dir)),
    });
  }

  return {
    projects: projects.sort((a, b) => a.name.localeCompare(b.name)),
    untracked: untracked.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Describe a single workspace project by absolute path, or undefined if it
 * is not a git directory. Used to surface overseer-personality before the
 * full workspace scan. */
export async function describeProject(
  dir: string,
): Promise<DiscoveredProject | undefined> {
  try {
    if (!(await stat(dir)).isDirectory()) return undefined;
    await stat(path.join(dir, ".git"));
  } catch {
    return undefined;
  }
  return {
    name: path.basename(dir),
    path: dir,
    ...(await readGitState(dir)),
  };
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
