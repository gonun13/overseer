/**
 * The server's version-control surface — every `git` the app runs comes from
 * here.
 *
 * Before this module the server spawned `git` from three unrelated places
 * (`project-git.ts`, `git-probe.ts`, and `project-create.ts`'s own
 * `defaultGitInit`), each with its own runner, timeout and idea of the
 * environment. Nothing enforced that a change to how git is invoked — an
 * identity override, an ssh configuration, a new failure to classify — reached
 * all three. Collecting them behind one directory is what makes "the operator's
 * key and identity apply to every git operation" a property of the code rather
 * than something to remember at each call site.
 *
 * The split inside:
 *
 * - `ops.ts`   on-demand operator operations. A person pressed a button and is
 *              waiting, so these always spawn — never cached.
 * - `probe.ts` the background branch/dirtiness read behind the project list.
 *              Cached, gated on `.git/HEAD` identity, and generous with its
 *              timeout because a stalled bind mount is not a failure.
 *
 * Those two are deliberately *not* merged: they answer the same questions with
 * opposite trade-offs, which is exactly why the probe's header warns against
 * routing operator reads through it.
 *
 * What does not live here: `workspace.ts` still owns `WORKSPACE_ROOT`,
 * `isInsideWorkspace` and `scanWorkspace`. Those are filesystem-containment
 * concerns that happen to be asked about git repositories, and eight modules
 * depend on them; its `readGitState` is a thin delegate to the probe below.
 */

export {
  createProjectGit,
  projectGit,
  type GitStatus,
  type GitOpResult,
  type MergeResult,
  type ProjectGitDeps,
} from "./ops.js";

export {
  createGitSsh,
  gitSsh,
  parseRemoteHost,
  type GitSshDeps,
  type SshKeyState,
  type SshTestResult,
} from "./ssh.js";

export {
  FALLBACK_IDENTITY,
  identityEnv,
  resolveIdentityEnv,
  type GitIdentity,
} from "./env.js";

export {
  createGitProbe,
  gitProbe,
  DIRTY_MIN_MS,
  PROBE_TIMEOUT_MS,
  SLOW_PROBE_MS,
  type GitMeta,
  type GitProbeDeps,
  type ProbeEvent,
  type ProbeEventKind,
} from "./probe.js";
