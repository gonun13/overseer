import { execFile } from "node:child_process";
import { readdir, realpath, stat } from "node:fs/promises";
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

/**
 * Whether `candidate` is really a path under the workspace root.
 *
 * The check is `realpath` on both sides and then a separator-terminated
 * prefix test, never a string comparison on the input: `..` segments and
 * symlinks each survive the string form and neither survives this one. A
 * symlink matters more here than it looks — it is resolved in the
 * *container's* namespace, so `ln -s /app/.overseer /workspace/mem` written
 * from the host would otherwise hand a caller the internal-memory volume
 * under a workspace-looking path. Internal memory being unreachable from the
 * workspace is what makes the §6.1 precedence rule a rule (memory/internal.ts).
 *
 * Strictly under: the root itself is a mount, not a project, and nothing
 * should be operating on it as one.
 */
export async function isInsideWorkspace(
  candidate: string,
  root = WORKSPACE_ROOT,
): Promise<boolean> {
  try {
    const realRoot = await realpath(root);
    const real = await realpath(candidate);
    return real.startsWith(realRoot + path.sep);
  } catch {
    // Unresolvable is not inside. A path that does not exist, or that we
    // cannot read, is not one to hand on as a project either way.
    return false;
  }
}

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
 *
 * `git: false` returns the same shape without `gitBranch`/`dirty`. The monitor
 * uses it for the cheap path-membership test; live branch/dirtiness is filled
 * in separately with `withGitMeta` / a full scan when something actually moved.
 */
export async function scanWorkspace(
  root = WORKSPACE_ROOT,
  opts: { git?: boolean } = {},
): Promise<WorkspaceScan> {
  const withGit = opts.git !== false;
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
    // Symlinks are still followed — a symlinked project is a normal way to
    // expose one repo — but only as far as the workspace. A link the host
    // wrote pointing at `/app/.overseer` or `claude-home` would otherwise be
    // listed as an ordinary project, which is exactly the reachability the
    // rest of the design says these volumes do not have.
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!isProjectCandidate(entry.name)) continue;

    const dir = path.join(root, entry.name);
    if (!(await isInsideWorkspace(dir, root))) continue;
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
      ...(withGit ? await readGitState(dir) : {}),
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
  // Same containment gate as the scan: this one is reached with a
  // server-computed path today, but a project is a project by the same rule
  // however it was named.
  if (!(await isInsideWorkspace(dir))) return undefined;
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

/**
 * Branch and dirtiness from the instance `git` CLI. Each probe is independent:
 * a failed `status` must not erase a good branch, and neither defaults on
 * failure — "clean" and "not determined" are different answers.
 *
 * Detached HEAD reports as `detached` (`git branch --show-current` is empty
 * there; `rev-parse --abbrev-ref` would only say `HEAD`).
 */
export async function readGitState(
  dir: string,
): Promise<{ gitBranch?: string; dirty?: boolean }> {
  const [gitBranch, dirty] = await Promise.all([
    readGitBranch(dir),
    readGitDirty(dir),
  ]);
  return {
    ...(gitBranch !== undefined ? { gitBranch } : {}),
    ...(dirty !== undefined ? { dirty } : {}),
  };
}

/** Re-read branch/dirtiness for an existing list without another readdir. */
export async function withGitMeta(
  projects: DiscoveredProject[],
): Promise<DiscoveredProject[]> {
  return Promise.all(
    projects.map(async (project) => ({
      name: project.name,
      path: project.path,
      ...(await readGitState(project.path)),
    })),
  );
}

async function readGitBranch(dir: string): Promise<string | undefined> {
  try {
    const { stdout } = await run("git", ["branch", "--show-current"], {
      cwd: dir,
      timeout: 5_000,
    });
    const name = stdout.trim();
    // Empty stdout with a zero exit is detached HEAD, not a missing answer.
    return name.length > 0 ? name : "detached";
  } catch (error) {
    console.error(
      `overseer: git branch failed in ${dir}`,
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

async function readGitDirty(dir: string): Promise<boolean | undefined> {
  try {
    const { stdout } = await run("git", ["status", "--porcelain"], {
      cwd: dir,
      timeout: 5_000,
    });
    return stdout.trim().length > 0;
  } catch (error) {
    console.error(
      `overseer: git status failed in ${dir}`,
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}
