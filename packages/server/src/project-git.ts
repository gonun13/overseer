import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitFileChange } from "@overseer/protocol";

const execFileAsync = promisify(execFile);

export interface GitStatus {
  branch: string;
  dirty: boolean;
  hasRemote: boolean;
  ahead?: number;
  behind?: number;
  files: GitFileChange[];
}

export type GitOpResult =
  | { ok: true }
  | { ok: false; reason: string; benign: boolean };

export interface ProjectGitDeps {
  /** One `git` invocation in `dir`, with optional env overrides. Swappable in
   * tests for canned stdout/stderr instead of a real process — same shape
   * `execFile` already gives, just narrowed to what callers here read. */
  run?: (
    dir: string,
    args: string[],
    env?: NodeJS.ProcessEnv,
  ) => Promise<{ stdout: string; stderr: string }>;
}

async function defaultRun(
  dir: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    cwd: dir,
    timeout: 10_000,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
}

/** Overseer's fallback identity, applied as environment overrides rather than
 * `-c user.name=`/`user.email=` — the dev/prod compose files pass
 * `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_*` through from the
 * host and default them to *empty strings* when the host has none set, and
 * git resolves identity from those env vars before `-c` config, so an empty
 * env var beats a `-c` override and still fails with "empty ident name".
 * Overriding the env vars directly is the only fallback that actually wins. */
const FALLBACK_IDENTITY_ENV: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: "overseer",
  GIT_AUTHOR_EMAIL: "overseer@localhost",
  GIT_COMMITTER_NAME: "overseer",
  GIT_COMMITTER_EMAIL: "overseer@localhost",
};

/** Builds the project-git operations with an injectable git runner — the same
 * DI shape `project-create.ts` uses, so each operation is testable against
 * canned git output instead of a real repository. */
export function createProjectGit(deps: ProjectGitDeps = {}) {
  const run = deps.run ?? defaultRun;

  async function status(dir: string): Promise<GitStatus> {
    const { stdout } = await run(dir, [
      "status",
      "--porcelain=v1",
      "--branch",
    ]);
    const lines = stdout.split("\n").filter((line) => line.length > 0);

    let branch = "detached";
    let ahead: number | undefined;
    let behind: number | undefined;
    const files: GitFileChange[] = [];

    for (const line of lines) {
      if (line.startsWith("## ")) {
        const header = line.slice(3);
        // "main...origin/main [ahead 1, behind 2]" | "main" | "HEAD (no branch)"
        const branchPart = header.split("...")[0]?.trim();
        if (branchPart && branchPart !== "HEAD (no branch)") branch = branchPart;
        const aheadMatch = header.match(/ahead (\d+)/);
        const behindMatch = header.match(/behind (\d+)/);
        if (aheadMatch) ahead = Number(aheadMatch[1]);
        if (behindMatch) behind = Number(behindMatch[1]);
        continue;
      }
      const code = line.slice(0, 2);
      const filePath = line.slice(3).trim();
      files.push({ path: filePath, status: statusFromCode(code) });
    }

    const { stdout: remoteOut } = await run(dir, ["remote"]);

    return {
      branch,
      dirty: files.length > 0,
      hasRemote: remoteOut.trim().length > 0,
      ...(ahead !== undefined ? { ahead } : {}),
      ...(behind !== undefined ? { behind } : {}),
      files,
    };
  }

  /**
   * Whether git can already resolve a real commit identity here — checked
   * with `git var GIT_AUTHOR_IDENT` rather than reading `user.name`/
   * `user.email` config directly, because it is the one probe that respects
   * git's actual precedence order. `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env
   * vars win over any `user.name`/`user.email` config (local, global, or
   * `-c`) — and the dev/prod compose files set those to *empty strings* when
   * the host has none configured, which otherwise poisons every commit with
   * "empty ident name" even when the repo's own config is fine.
   */
  async function hasIdentity(dir: string): Promise<boolean> {
    try {
      await run(dir, ["var", "GIT_AUTHOR_IDENT"]);
      return true;
    } catch {
      return false;
    }
  }

  async function commit(dir: string, message: string): Promise<GitOpResult> {
    const { stdout } = await run(dir, ["status", "--porcelain"]);
    if (stdout.trim().length === 0) {
      return { ok: false, benign: true, reason: "nothing to commit" };
    }

    try {
      await run(dir, ["add", "-A"]);
      const identity = await hasIdentity(dir);
      await run(
        dir,
        ["commit", "-m", message],
        identity ? undefined : FALLBACK_IDENTITY_ENV,
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, benign: false, reason: describe(error) };
    }
  }

  async function push(dir: string): Promise<GitOpResult> {
    try {
      const { branch } = await status(dir);
      await run(dir, ["push", "-u", "origin", branch]);
      return { ok: true };
    } catch (error) {
      return { ok: false, benign: true, reason: describe(error) };
    }
  }

  async function mergeToMain(dir: string): Promise<GitOpResult> {
    const current = await status(dir);
    if (current.hasRemote) {
      return {
        ok: false,
        benign: true,
        reason: "a remote is attached — merge through the upstream PR process",
      };
    }
    if (current.branch === "main") {
      return { ok: false, benign: true, reason: "already on main" };
    }

    const branch = current.branch;
    try {
      await run(dir, ["checkout", "main"]);
    } catch (error) {
      return { ok: false, benign: true, reason: describe(error) };
    }

    try {
      // --no-ff always makes a real merge commit, even when the merge would
      // otherwise fast-forward — so it needs the same identity fallback
      // `commit` does.
      const identity = await hasIdentity(dir);
      await run(
        dir,
        ["merge", "--no-ff", branch],
        identity ? undefined : FALLBACK_IDENTITY_ENV,
      );
      return { ok: true };
    } catch (error) {
      await run(dir, ["merge", "--abort"]).catch(() => {});
      return {
        ok: false,
        benign: true,
        reason: `merge conflict — aborted, still on main: ${describe(error)}`,
      };
    }
  }

  async function revert(dir: string): Promise<GitOpResult> {
    try {
      await run(dir, ["reset", "--hard", "HEAD"]);
    } catch (error) {
      return {
        ok: false,
        benign: true,
        reason: `nothing to revert to: ${describe(error)}`,
      };
    }
    try {
      await run(dir, ["clean", "-fd"]);
      return { ok: true };
    } catch (error) {
      return { ok: false, benign: false, reason: describe(error) };
    }
  }

  return { status, commit, push, mergeToMain, revert };
}

function statusFromCode(code: string): GitFileChange["status"] {
  if (code === "??") return "untracked";
  if (code.includes("U") || code === "AA" || code === "DD") return "unmerged";
  if (code.includes("R")) return "renamed";
  if (code.includes("A")) return "added";
  if (code.includes("D")) return "deleted";
  return "modified";
}

function describe(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string" && stderr.trim().length > 0) {
      return stderr.trim().split("\n")[0] ?? stderr.trim();
    }
  }
  return error instanceof Error ? error.message : "git operation failed";
}

/** The instance `ws.ts` uses. */
export const projectGit = createProjectGit();
