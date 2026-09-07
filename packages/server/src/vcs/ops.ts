import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitFileChange } from "@overseer/protocol";
import { readGitIdentity } from "../memory/internal.js";
import { resolveIdentityEnv, type GitIdentity } from "./env.js";

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

/** `mergeToDefault`'s result carries which branch it merged from and into —
 * the ack to the client names both, and the client no longer has to assume
 * the target was `main`. */
export type MergeResult =
  | { ok: true; from: string; into: string }
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
  /** The operator's configured commit identity. Injectable so tests need
   * neither internal memory nor a real snapshot. */
  readIdentity?: () => Promise<GitIdentity | undefined>;
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

/** The operator's configured identity, if they have set one. Injectable so
 * tests never touch internal memory; defaults to reading the snapshot. */
async function defaultReadIdentity(): Promise<GitIdentity | undefined> {
  return readGitIdentity();
}

/** Builds the project-git operations with an injectable git runner — the same
 * DI shape `project-create.ts` uses, so each operation is testable against
 * canned git output instead of a real repository. */
export function createProjectGit(deps: ProjectGitDeps = {}) {
  const run = deps.run ?? defaultRun;
  const readIdentity = deps.readIdentity ?? defaultReadIdentity;

  /** The identity overrides for a write in `dir` — see `env.ts` for why this
   * is environment rather than config. */
  const identityFor = (dir: string) =>
    resolveIdentityEnv(dir, readIdentity, hasIdentity);

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
      await run(dir, ["commit", "-m", message], await identityFor(dir));
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
      return {
        ok: false,
        benign: true,
        // Classified against the *whole* of stderr, not `describe`'s first
        // line: git prints a multi-line warning banner ahead of "Host key
        // verification failed", so the signature is never on line one.
        reason: await explainPushFailure(dir, stderrOf(error), describe(error)),
      };
    }
  }

  /**
   * Turn a push failure into something the operator can act on.
   *
   * Raw git says `Permission denied (publickey)`, which names the mechanism
   * and not the fix. Since the container's key is generated in settings, an
   * operator who has never opened that panel has no way to connect the two —
   * this is the only place the feature announces where it lives.
   *
   * The https case is the one that would otherwise be genuinely baffling: the
   * key is set up correctly and simply is not used, because git does not
   * authenticate an https remote with it.
   */
  async function explainPushFailure(
    dir: string,
    full: string,
    summary: string,
  ): Promise<string> {
    if (/host key verification failed/i.test(full)) {
      return `the remote's host key changed — check settings › git access · ${summary}`;
    }
    if (/could not read from remote repository|permission denied \(publickey\)/i.test(full)) {
      if (await hasHttpsOrigin(dir)) {
        return `this project's remote uses https, so the ssh key does not apply — switch the remote to ssh to use it · ${summary}`;
      }
      return `no ssh key is set up for this remote — add one in settings › git access · ${summary}`;
    }
    return summary;
  }

  /**
   * Also record the identity in the container's global git config.
   *
   * The env overrides above cover what *this server* runs. They do not reach
   * the agent's own `git commit` inside a session, the console, or the dev
   * loop — all of which are separate children that resolve identity for
   * themselves. Writing `~/.gitconfig` covers those without threading
   * overrides through every spawn point.
   *
   * This only works because `dropEmptyIdentityEnv` runs at boot: with an empty
   * `GIT_AUTHOR_NAME` still inherited, git would ignore this file entirely.
   *
   * Written with `git config` rather than by hand so the rest of the file is
   * preserved and the values are escaped by git itself.
   */
  async function setGlobalIdentity(identity: GitIdentity): Promise<void> {
    const home = process.env.HOME ?? "/home/overseer";
    await run(home, ["config", "--global", "user.name", identity.name]);
    await run(home, ["config", "--global", "user.email", identity.email]);
  }

  /** The `origin` URL, verbatim. Throws when there is no origin, which is an
   * ordinary state for a project the operator has not pushed anywhere. */
  async function remoteUrl(dir: string): Promise<{ stdout: string }> {
    const { stdout } = await run(dir, ["remote", "get-url", "origin"]);
    return { stdout: stdout.trim() };
  }

  async function hasHttpsOrigin(dir: string): Promise<boolean> {
    try {
      const { stdout } = await remoteUrl(dir);
      return /^https?:\/\//i.test(stdout);
    } catch {
      return false;
    }
  }

  /**
   * The branch this project treats as its trunk — not always `main`: a repo
   * that predates that convention, or one cloned from a remote that names
   * its own, has to be merged into the branch it actually has.
   *
   * Preference order: the remote's own notion of default, when `origin/HEAD`
   * is recorded locally (the same thing `git clone` sets up); else whichever
   * of `main`/`master` exists as a local branch, in that order; else the
   * current branch itself — nothing conventional to point at, so the closest
   * thing this repo has to a default is wherever HEAD already is.
   */
  async function defaultBranch(dir: string): Promise<string> {
    try {
      const { stdout } = await run(dir, [
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
      ]);
      const short = stdout.trim().replace(/^refs\/remotes\/origin\//, "");
      if (short) return short;
    } catch {
      // No remote, or one whose HEAD was never recorded locally (common
      // right after `git remote add` without a fetch) — fall through.
    }

    try {
      const { stdout } = await run(dir, [
        "branch",
        "--format=%(refname:short)",
      ]);
      const branches = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (branches.includes("main")) return "main";
      if (branches.includes("master")) return "master";
    } catch {
      // No local branches to enumerate — an empty, commit-less repo.
    }

    const { stdout: currentOut } = await run(dir, ["branch", "--show-current"]);
    return currentOut.trim() || "main";
  }

  async function mergeToDefault(dir: string): Promise<MergeResult> {
    const current = await status(dir);
    if (current.hasRemote) {
      return {
        ok: false,
        benign: true,
        reason: "a remote is attached — merge through the upstream PR process",
      };
    }

    const target = await defaultBranch(dir);
    if (current.branch === target) {
      return { ok: false, benign: true, reason: `already on ${target}` };
    }

    const branch = current.branch;
    try {
      await run(dir, ["checkout", target]);
    } catch (error) {
      return { ok: false, benign: true, reason: describe(error) };
    }

    try {
      // --no-ff always makes a real merge commit, even when the merge would
      // otherwise fast-forward — so it needs the same identity resolution
      // `commit` does.
      await run(dir, ["merge", "--no-ff", branch], await identityFor(dir));
      return { ok: true, from: branch, into: target };
    } catch (error) {
      await run(dir, ["merge", "--abort"]).catch(() => {});
      return {
        ok: false,
        benign: true,
        reason: `merge conflict — aborted, still on ${target}: ${describe(error)}`,
      };
    }
  }

  /**
   * `git init -b main` in an existing directory.
   *
   * `-b main`: don't inherit whatever `init.defaultBranch` happens to be, and
   * don't emit git's "using master" advice — the same reasoning
   * `memory/personality/scaffold.ts` gives for its own `git init -q -b main`.
   *
   * Lives here rather than in `project-create.ts` so that every git invocation
   * the server makes goes through this module; `project-create` keeps its
   * `gitInit` dependency seam and simply defaults to this.
   */
  async function init(dir: string): Promise<void> {
    await run(dir, ["init", "-b", "main"]);
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

  return {
    status,
    commit,
    push,
    defaultBranch,
    mergeToDefault,
    revert,
    init,
    remoteUrl,
    setGlobalIdentity,
  };
}

function statusFromCode(code: string): GitFileChange["status"] {
  if (code === "??") return "untracked";
  if (code.includes("U") || code === "AA" || code === "DD") return "unmerged";
  if (code.includes("R")) return "renamed";
  if (code.includes("A")) return "added";
  if (code.includes("D")) return "deleted";
  return "modified";
}

/** The whole of a failed command's stderr, for matching signatures that git
 * does not print on the first line. */
function stderrOf(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string") return stderr;
  }
  return error instanceof Error ? error.message : "";
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
