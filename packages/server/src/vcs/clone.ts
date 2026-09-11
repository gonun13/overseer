import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Cloning a repository the operator named, for the skill importer.
 *
 * Its own module rather than a method on `createProjectGit`: everything there
 * is an operation *on a project* — a cwd inside the workspace, a 10-second
 * timeout, the operator's commit identity. A clone has none of those. It runs
 * against a URL the operator typed, it reaches the network, and its cwd is a
 * staging directory that is not a repository at all. Folding it in would mean
 * loosening three properties of that module for one caller that shares none of
 * its assumptions.
 *
 * What this does share is the rule the directory exists for: every `git` the
 * server runs is spawned from `vcs/`.
 */

/**
 * A clone is the network operation in this app, and the only one an operator
 * waits on without a stream to watch. Long enough for a real repository over a
 * slow link, short enough that a wedged connection surfaces as a refusal rather
 * than a spinner that never resolves.
 */
const CLONE_TIMEOUT_MS = 60_000;

/** Shallow and blobless: the importer copies a working tree out and throws the
 * repository away, so history is pure cost. */
const CLONE_ARGS = ["--depth", "1", "--filter=blob:none", "--single-branch"];

export type CloneResult = { ok: true } | { ok: false; reason: string };

/**
 * Whether this is a URL the importer will fetch.
 *
 * **`https` only, deliberately.** git speaks a family of transports, and most
 * of them do something an operator-supplied string must not be able to ask for:
 * `file://` and a bare local path read the container's own filesystem (the
 * staging directory sits next to the operator's projects), `ext::` executes an
 * arbitrary command by design, and `ssh://` — along with scp-style
 * `git@host:path` — would spend the instance's own deploy key against a host
 * the operator chose. None of those is a skill source anyone needs, so the
 * allowlist is one scheme rather than a list of things to block.
 *
 * `http` is refused too: a skill is code that a session will act on, and
 * fetching it in the clear invites a rewrite in transit.
 */
export function isAllowedCloneUrl(raw: string): boolean {
  const value = raw.trim();
  if (value === "") return false;
  // A scp-style remote (`git@github.com:owner/repo.git`) has no scheme for
  // `URL` to reject, so it has to be caught by shape first.
  if (/^[^/\s]+@[^/\s]+:/.test(value)) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname === "") return false;
  // `--upload-pack` and friends travel as options, not as a host; a URL whose
  // authority starts with a dash would reach git's argv as one.
  if (parsed.hostname.startsWith("-")) return false;
  return true;
}

export interface CloneDeps {
  run?: (
    args: string[],
    env: NodeJS.ProcessEnv,
  ) => Promise<{ stdout: string; stderr: string }>;
}

async function defaultRun(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    timeout: CLONE_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, ...env },
  });
}

/**
 * Clone `url` into `dest`, which must not exist yet.
 *
 * Never throws: a clone fails for ordinary reasons an operator needs to read
 * (a typo, a private repository, a branch that is not there), so the failure is
 * a value rather than an exception.
 */
export async function cloneInto(
  url: string,
  ref: string | undefined,
  dest: string,
  deps: CloneDeps = {},
): Promise<CloneResult> {
  if (!isAllowedCloneUrl(url)) {
    return { ok: false, reason: "only https:// git urls can be imported" };
  }

  const run = deps.run ?? defaultRun;
  const args = [
    "clone",
    ...CLONE_ARGS,
    ...(ref !== undefined && ref.trim() !== "" ? ["--branch", ref.trim()] : []),
    // Everything after this is data, not flags — without it a URL or ref
    // beginning with a dash would be read as one.
    "--",
    url,
    dest,
  ];

  try {
    await run(args, {
      // A private repository must fail, not sit waiting for a password that no
      // one is there to type. All three are needed: git falls back through
      // them, and leaving any one unset restores the hang.
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "/bin/false",
      SSH_ASKPASS: "/bin/false",
      // The operator's own `~/.gitconfig` must not redirect this: `url.*
      // .insteadOf` could rewrite an allowed https url into a transport the
      // check above just refused.
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: describeCloneFailure(error) };
  }
}

/**
 * git's stderr, reduced to the line that tells the operator what to change.
 *
 * A failed clone prints progress and hints around the one sentence that
 * matters; handing all of it to a window would bury the answer.
 */
function describeCloneFailure(error: unknown): string {
  const stderr =
    typeof (error as { stderr?: unknown })?.stderr === "string"
      ? ((error as { stderr: string }).stderr as string)
      : "";

  if ((error as { killed?: boolean })?.killed === true) {
    return "the clone timed out";
  }

  const fatal = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().startsWith("fatal:"));
  if (fatal !== undefined) {
    const message = fatal.replace(/^fatal:\s*/i, "");
    // Authentication failures read as a wall of URL; say the useful part.
    if (/authentication failed|could not read username|terminal prompts/i.test(message)) {
      return "that repository is private, or does not exist";
    }
    return message;
  }

  return error instanceof Error ? error.message : "the clone failed";
}
