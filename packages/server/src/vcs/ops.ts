import { execFile } from "node:child_process";
import { readFile as fsReadFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  GIT_MAX_DIFF_CHARS,
  GIT_MAX_DIFF_LINES,
  GIT_MAX_DIR_ENTRIES,
  type GitDirEntry,
  type GitFileChange,
} from "@overseer/protocol";
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

/** What a read of one file returns — a diff or the file's own contents.
 *
 * A result rather than a throw, unlike `status`: `status` fails only when the
 * directory is not a repository at all, which is one catastrophe the caller
 * translates once, while a file read has ordinary operator-facing refusals (a
 * binary file, one too large to show, a path git has never heard of). Those
 * are the shape `commit` and `revert` already model.
 *
 * `truncated` is a property of a successful read, not a failure: a diff past
 * the cap is still worth showing the top of, and saying so is more useful than
 * refusing it. */
export type GitReadResult =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; reason: string; benign: boolean };

/** What a listing of one folder returns — the same result shape a file read
 * uses, and for the same reason: a folder git has never heard of is an
 * ordinary operator-facing refusal, not a catastrophe. An empty folder is a
 * success with no entries, never a failure. */
export type GitListResult =
  | { ok: true; entries: GitDirEntry[]; truncated: boolean }
  | { ok: false; reason: string; benign: boolean };

/** `pull`'s result names the branch and how many commits came down, so the ack
 * can say what arrived rather than only that something did. */
export type PullResult =
  | { ok: true; branch: string; merged: number }
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
  /** One working-tree file read, by absolute path. Injectable for the same
   * reason `run` is — the content view is not a git question, but it is the
   * same operation from the operator's side, and the suite should not need a
   * real file to test the refusals. Returns the bytes so the caller can decide
   * about size and binaryness rather than being handed a lossy string. */
  readFile?: (absolute: string) => Promise<Buffer>;
}

async function defaultRun(
  dir: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    cwd: dir,
    timeout: 10_000,
    // Without this, `execFile`'s implicit 1 MiB decides how big a diff may be,
    // and it decides by rejecting with an opaque ERR_CHILD_PROCESS_STDOUT_
    // MAXBUFFER rather than by clipping. The cap this project actually wants
    // is `capped()` below, applied to output that arrived intact — so the
    // buffer is set well past it, and truncation stays a deliberate act.
    maxBuffer: 4 * GIT_MAX_DIFF_CHARS,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
}

/** The operator's configured identity, if they have set one. Injectable so
 * tests never touch internal memory; defaults to reading the snapshot. */
async function defaultReadIdentity(): Promise<GitIdentity | undefined> {
  return readGitIdentity();
}

/** git's canonical empty tree. Diffing against it is how a repository with no
 * commits yet gets a diff at all, since `HEAD` is not a revision there. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * The flags every diff read carries.
 *
 * These are a defence, not a preference. `git diff` honours
 * `diff.<driver>.command` and `textconv` from a repository's own config and
 * `.gitattributes` — and the agent writes into `/workspace`, so the repository
 * being read is not necessarily one the operator wrote. `--no-ext-diff` and
 * `--no-textconv` keep a checked-in config from choosing what this spawns.
 * `--no-color` because a repo can set `color.ui = always`, and the window
 * renders the text rather than interpreting escapes. `core.quotepath=false` so
 * a non-ASCII path arrives readable instead of octal-escaped.
 */
const DIFF_FLAGS = [
  "--no-pager",
  "-c",
  "core.quotepath=false",
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "-M",
  "--unified=3",
];

/** `--no-index` takes no revision, so it needs its own flag list — same
 * hardening, minus the rename detection that has nothing to compare. */
const NO_INDEX_DIFF_FLAGS = [
  "--no-pager",
  "-c",
  "core.quotepath=false",
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--unified=3",
  "--no-index",
];

/** Clip a read to the caps the protocol publishes, reporting whether it had
 * to. Lines first, then characters: either can be the limit that matters (a
 * minified file is one enormous line; a generated file is a million short
 * ones), so whichever trips first wins. */
function capped(text: string): GitReadResult {
  const lines = text.split("\n");
  const overLines = lines.length > GIT_MAX_DIFF_LINES;
  const clipped = overLines ? lines.slice(0, GIT_MAX_DIFF_LINES).join("\n") : text;
  const overChars = clipped.length > GIT_MAX_DIFF_CHARS;
  return {
    ok: true,
    text: overChars ? clipped.slice(0, GIT_MAX_DIFF_CHARS) : clipped,
    truncated: overLines || overChars,
  };
}

/** The stdout of a command that exited non-zero. `git diff --no-index` exits 1
 * to mean "these differ", which is a normal answer wearing a failure's
 * clothes. */
function stdoutOf(error: unknown): string | undefined {
  if (error && typeof error === "object" && "stdout" in error) {
    const stdout = (error as { stdout?: unknown }).stdout;
    if (typeof stdout === "string") return stdout;
  }
  return undefined;
}

/** Builds the project-git operations with an injectable git runner — the same
 * DI shape `project-create.ts` uses, so each operation is testable against
 * canned git output instead of a real repository. */
export function createProjectGit(deps: ProjectGitDeps = {}) {
  const run = deps.run ?? defaultRun;
  const readIdentity = deps.readIdentity ?? defaultReadIdentity;
  const readFileBytes = deps.readFile ?? ((absolute: string) => fsReadFile(absolute));

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
        // git prints the divergence bracket only when there *is* divergence:
        // an upstream that matches HEAD exactly prints nothing after the
        // "branch...upstream" pair. So presence of the pair — not of the
        // bracket — is what says a comparison happened, and a branch with an
        // upstream and no bracket is 0 ahead, 0 behind rather than unknown.
        // "[gone]" is the exception: the upstream is configured but no longer
        // exists, so there is nothing to compare against and both stay absent.
        const hasUpstream = header.includes("...") && !header.includes("[gone]");
        if (hasUpstream) {
          ahead = 0;
          behind = 0;
        }
        const aheadMatch = header.match(/ahead (\d+)/);
        const behindMatch = header.match(/behind (\d+)/);
        if (aheadMatch) ahead = Number(aheadMatch[1]);
        if (behindMatch) behind = Number(behindMatch[1]);
        continue;
      }
      const change = parsePorcelainFile(line);
      if (change) files.push(change);
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

  /** The revision a working-tree diff is taken against: `HEAD` normally, and
   * git's canonical empty tree in a repository with no commits yet, where
   * `HEAD` is not a revision at all and naming it is an error. Diffing against
   * the empty tree makes every tracked file read as an addition, which is
   * exactly what it is. */
  async function diffBase(dir: string): Promise<string> {
    try {
      await run(dir, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
      return "HEAD";
    } catch {
      return EMPTY_TREE;
    }
  }

  /**
   * The unified diff of one file against the last commit.
   *
   * Against `HEAD` rather than the index or the worktree alone, because
   * `commit` stages everything (`git add -A`) before committing — so the
   * change the operator is about to record *is* the worktree against HEAD, and
   * a staged/unstaged split would show them half of it and match no button in
   * the window.
   *
   * `previousPath` is passed for a renamed file: `-M` only detects a rename
   * when both names are in the pathspec, and given the new one alone git
   * reports a whole-file addition.
   */
  async function diffFile(
    dir: string,
    file: string,
    previousPath?: string,
  ): Promise<GitReadResult> {
    try {
      const base = await diffBase(dir);
      const paths = previousPath ? [previousPath, file] : [file];
      const { stdout } = await run(dir, [...DIFF_FLAGS, base, "--", ...paths]);
      if (stdout.length > 0) return capped(stdout);
      // Empty output means git knows nothing about this path at this revision.
      // The remaining case is an untracked file, which no revision diff can
      // reach. Falling through on the *output* rather than on the status word
      // the client sent is deliberate: that word can be stale by the time the
      // click lands, and this way one path covers an untracked file, a file
      // committed out from under the operator, and a repository with nothing
      // committed yet.
      return capped(await noIndexDiff(dir, file));
    } catch (error) {
      return { ok: false, benign: true, reason: describe(error) };
    }
  }

  /** A diff of an untracked file against nothing. `--no-index` puts git in
   * plain-`diff` mode, where it exits 1 whenever the two inputs differ — which
   * `execFile` reports as a rejection even though the diff it produced is
   * exactly what was wanted, so the output is recovered off the error. */
  async function noIndexDiff(dir: string, file: string): Promise<string> {
    try {
      const { stdout } = await run(dir, [
        ...NO_INDEX_DIFF_FLAGS,
        "--",
        "/dev/null",
        file,
      ]);
      return stdout;
    } catch (error) {
      const stdout = stdoutOf(error);
      // No stdout at all is a real failure (an unreadable path, a git that
      // could not start) rather than the ordinary "they differ" exit.
      if (stdout === undefined) throw error;
      return stdout;
    }
  }

  /**
   * One file's current contents, read from the worktree.
   *
   * The worktree rather than `git show`: the toggle in the window says
   * "contents", and `git show` can only reach a blob that is committed or
   * staged — which is never the file the operator is looking at when they open
   * this on an uncommitted change.
   */
  async function readFile(dir: string, file: string): Promise<GitReadResult> {
    try {
      const bytes = await readFileBytes(path.resolve(dir, file));
      // A NUL in the first block is the same heuristic git uses to call a file
      // binary. Refusing is kinder than rendering a window of replacement
      // characters, and it is benign: nothing is broken, the file simply is
      // not text.
      if (bytes.subarray(0, 8_192).includes(0)) {
        return { ok: false, benign: true, reason: "binary file" };
      }
      return capped(bytes.toString("utf8"));
    } catch (error) {
      return { ok: false, benign: true, reason: describe(error) };
    }
  }

  /**
   * The changed children directly inside one folder of the worktree.
   *
   * Built from `git status`, not from a directory read. That is the whole
   * point: git is what collapsed an untracked directory into the single row
   * this opens, `-uall` is what un-collapses it, and asking git rather than
   * the filesystem means every child arrives with its status already attached,
   * ignored files stay out of the list, and a symlink is reported as itself
   * rather than followed into whatever it aims at.
   *
   * So a listing says what a commit made from the project window would take
   * from this folder — the same framing the file view has. A subfolder holding
   * nothing git would commit does not appear, which is that framing being
   * honest rather than a gap.
   *
   * `--` so a folder whose name begins with a dash cannot be read as a flag,
   * and `core.quotepath=false` so a non-ASCII name arrives readable instead of
   * octal-escaped — the same hardening `DIFF_FLAGS` carries.
   */
  async function listDir(dir: string, folder: string): Promise<GitListResult> {
    let stdout: string;
    try {
      ({ stdout } = await run(dir, [
        "-c",
        "core.quotepath=false",
        "status",
        "--porcelain=v1",
        "-uall",
        "--",
        folder,
      ]));
    } catch (error) {
      return { ok: false, benign: true, reason: describe(error) };
    }

    const prefix = folder.endsWith("/") ? folder : `${folder}/`;
    // Insertion order is git's, which is not the order the window shows; the
    // sort below is what decides that. A map rather than a list because a
    // folder is named once per descendant and must appear once.
    const children = new Map<string, { kind: GitDirEntry["kind"]; statuses: Set<string> }>();

    for (const line of stdout.split("\n")) {
      if (line.length === 0) continue;
      const change = parsePorcelainFile(line);
      if (!change || !change.path.startsWith(prefix)) continue;
      const rest = change.path.slice(prefix.length);
      // A trailing slash means git collapsed a directory anyway — under
      // `-uall` that happens for a directory it was told to ignore, and the
      // name is still the child.
      const slash = rest.indexOf("/");
      const name = slash === -1 ? rest.replace(/\/$/, "") : rest.slice(0, slash);
      if (name.length === 0) continue;
      const kind: GitDirEntry["kind"] =
        slash === -1 && !rest.endsWith("/") ? "file" : "dir";
      const existing = children.get(name);
      if (existing) existing.statuses.add(change.status);
      else children.set(name, { kind, statuses: new Set([change.status]) });
    }

    const entries: GitDirEntry[] = [...children.entries()]
      .map(([name, child]) => {
        // A folder gets a status only when its descendants agree on one.
        // Disagreement is a real answer, and the row says so in words rather
        // than picking a winner.
        const only = child.statuses.size === 1 ? [...child.statuses][0] : undefined;
        return {
          name,
          kind: child.kind,
          ...(only ? { status: only as GitFileChange["status"] } : {}),
        };
      })
      .sort((a, b) =>
        a.kind === b.kind
          ? a.name.localeCompare(b.name)
          : a.kind === "dir"
            ? -1
            : 1,
      );

    const truncated = entries.length > GIT_MAX_DIR_ENTRIES;
    return {
      ok: true,
      entries: truncated ? entries.slice(0, GIT_MAX_DIR_ENTRIES) : entries,
      truncated,
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

  /**
   * Bring `origin`'s copy of one branch up to date. Best effort, and never
   * fatal: a remote that is unreachable, unauthenticated or simply slow is not
   * a reason to refuse the operation that asked for this. The caller carries on
   * with the local view, which is exactly what it had before.
   *
   * Branch-scoped rather than a whole-remote `git fetch`: this is on the path
   * of things the operator is waiting for, and the other branches are nobody's
   * question right now. It still updates `refs/remotes/origin/<branch>`, which
   * is the ref every ahead/behind count in this app is measured against.
   */
  async function fetchBranch(dir: string, branch: string): Promise<boolean> {
    try {
      await run(dir, ["fetch", "--quiet", "origin", branch]);
      return true;
    } catch {
      return false;
    }
  }

  /** How many commits the remote has that this checkout does not. `undefined`
   * when there is nothing to compare against — a branch that has never been
   * pushed has no `origin/<branch>`, and that is an ordinary state, not a
   * failure. */
  async function countBehind(
    dir: string,
    branch: string,
  ): Promise<number | undefined> {
    try {
      const { stdout } = await run(dir, [
        "rev-list",
        "--count",
        `HEAD..origin/${branch}`,
      ]);
      const count = Number(stdout.trim());
      return Number.isFinite(count) ? count : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Bring `origin`'s commits down into the current branch, by merge.
   *
   * Merge rather than rebase: rebase rewrites commits that may already be in a
   * session's hands, and a half-finished rebase is a state an operator has to
   * know git well to even recognise. A merge either lands or stops with
   * conflict markers in the files, which is a state the project window already
   * renders — `unmerged` is in its file-status vocabulary.
   *
   * A conflict is **not** cleaned up. No `--abort`, no reset: the half-merged
   * tree is the operator's to resolve in the workspace, with whatever tools
   * they like, and undoing it on their behalf would throw away the one thing
   * that tells them what actually disagreed.
   *
   * Refuses on a dirty tree, before touching anything. A merge into uncommitted
   * work either refuses partway through or entangles the operator's changes
   * with the remote's, and neither is something to discover afterwards.
   */
  async function pull(dir: string): Promise<PullResult> {
    const { branch, hasRemote, dirty } = await status(dir);
    if (!hasRemote) {
      return { ok: false, benign: true, reason: "this project has no remote to pull from" };
    }
    if (dirty) {
      return {
        ok: false,
        benign: true,
        reason: "commit or discard your changes before pulling — a merge cannot run over uncommitted work",
      };
    }

    if (!(await fetchBranch(dir, branch))) {
      return {
        ok: false,
        benign: true,
        reason: `could not reach origin to pull ${branch}`,
      };
    }

    const behind = await countBehind(dir, branch);
    if (behind === undefined) {
      return {
        ok: false,
        benign: true,
        reason: `origin has no ${branch} to pull from`,
      };
    }
    if (behind === 0) {
      return { ok: false, benign: true, reason: `${branch} is already up to date with origin` };
    }

    try {
      // A merge writes a commit when the histories have both moved, so it
      // needs an identity for the same reason `commit` does.
      await run(dir, ["merge", "--no-edit", `origin/${branch}`], await identityFor(dir));
      return { ok: true, branch, merged: behind };
    } catch (error) {
      // Both streams: git announces "CONFLICT (content): …" and "Automatic
      // merge failed" on stdout, not stderr.
      const full = `${stderrOf(error)}\n${stdoutOf(error) ?? ""}`;
      if (/conflict/i.test(full)) {
        const files = await conflictedFiles(dir);
        const named =
          files.length === 0
            ? "the merge conflicts"
            : files.length === 1
              ? `${files[0]} conflicts`
              : `${files.length} files conflict — ${files.slice(0, 3).join(", ")}${files.length > 3 ? "…" : ""}`;
        return {
          ok: false,
          benign: true,
          // Said plainly, because the tree is now in a state the operator has
          // to act on and nothing here is going to act on it for them.
          reason: `${named} · resolve in the project, then commit the merge`,
        };
      }
      return { ok: false, benign: false, reason: describe(error) };
    }
  }

  /** The paths git is holding as unmerged, for a conflict message that names
   * them rather than leaving the operator to go looking. */
  async function conflictedFiles(dir: string): Promise<string[]> {
    try {
      const { stdout } = await run(dir, ["diff", "--name-only", "--diff-filter=U"]);
      return stdout.split("\n").filter((line) => line.trim().length > 0);
    } catch {
      return [];
    }
  }

  async function push(dir: string): Promise<GitOpResult> {
    try {
      const { branch, hasRemote } = await status(dir);

      // Ask where the remote actually is before trying to move it. Nothing
      // else in this app fetches, so `origin/<branch>` — and every ahead/behind
      // count measured against it — is otherwise frozen at whenever this
      // checkout last spoke to the remote. A push then fails against a remote
      // the operator was shown as "0 behind" seconds earlier.
      if (hasRemote) {
        await fetchBranch(dir, branch);
        const behind = await countBehind(dir, branch);
        if (behind !== undefined && behind > 0) {
          return {
            ok: false,
            benign: true,
            reason: `the remote has ${behind} commit${behind === 1 ? "" : "s"} this project does not — pull them in first`,
          };
        }
      }

      await run(dir, ["push", "-u", "origin", branch]);
      return { ok: true };
    } catch (error) {
      const full = stderrOf(error);
      return {
        ok: false,
        benign: true,
        // Classified against the *whole* of stderr, not `describe`'s first
        // line: git prints a multi-line warning banner ahead of "Host key
        // verification failed", so the signature is never on line one.
        reason: await explainPushFailure(dir, full, describePush(full, error)),
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
    // The everyday one, and the only failure here that is nobody's mistake:
    // the remote moved on. Worth naming, because "fetch first" is git's
    // instruction to a terminal and this app has no terminal to obey it in.
    if (/\(fetch first\)|\(non-fast-forward\)|behind its remote counterpart/i.test(full)) {
      return `the remote has commits this project does not — pull them in first · ${summary}`;
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
    diffFile,
    readFile,
    listDir,
    commit,
    push,
    pull,
    fetchBranch,
    defaultBranch,
    mergeToDefault,
    revert,
    init,
    remoteUrl,
    setGlobalIdentity,
  };
}

/** One non-header line of `git status --porcelain=v1`, as a change.
 *
 * A rename is printed as `old -> new`, so the raw remainder is two paths and a
 * separator rather than one path. Split them: the new name is what the row is
 * *about*, and the old one is what makes a diff of it read as a rename instead
 * of a whole-file addition. Splitting on the last ` -> ` rather than the first,
 * since a filename may legitimately contain one.
 *
 * Shared by `status` and `listDir` — the same output, read once for a whole
 * worktree and once for one folder of it. */
function parsePorcelainFile(line: string): GitFileChange | undefined {
  if (line.length < 4) return undefined;
  const code = line.slice(0, 2);
  const raw = line.slice(3).trim();
  if (raw.length === 0) return undefined;
  const arrow = code.includes("R") ? raw.lastIndexOf(" -> ") : -1;
  const filePath = arrow === -1 ? raw : raw.slice(arrow + 4);
  const previousPath = arrow === -1 ? undefined : raw.slice(0, arrow);
  return {
    path: filePath,
    status: statusFromCode(code),
    ...(previousPath ? { previousPath } : {}),
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

/**
 * The one line of a push failure worth showing.
 *
 * `describe` takes stderr's first line, which works for most git commands and
 * is exactly wrong for `push`: the first line is always the `To <remote>`
 * header, the only line in the output that says nothing about what happened.
 * Operators were shown "To github.com:owner/repo.git" and nothing else.
 *
 * The reason sits under it, as `! [rejected] … (fetch first)` or an `error:`/
 * `fatal:` line. The `hint:` block under *that* is git's advice to someone at
 * a terminal ("use 'git pull'"), which is not the register's voice — and
 * `explainPushFailure` gives the actionable version anyway.
 */
function describePush(full: string, error: unknown): string {
  const lines = full
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const rejected = lines.find((line) => line.startsWith("!"));
  if (rejected) return rejected.replace(/^!\s*/, "");

  const failed = lines.find((line) => /^(error|fatal):/i.test(line));
  if (failed) return failed;

  const informative = lines.find(
    (line) => !/^to\s/i.test(line) && !/^hint:/i.test(line),
  );
  return informative ?? describe(error);
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
