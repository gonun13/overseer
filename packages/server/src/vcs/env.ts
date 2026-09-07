/**
 * Which identity a commit this app makes is authored under.
 *
 * The precedence here is not arbitrary, and it is not git's. The compose files
 * pass `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` and the `GIT_COMMITTER_*` pair
 * through from the host as `${VAR:-}`, so when the host has none set they
 * arrive in the container as **empty strings** rather than absent. Git reads
 * those environment variables ahead of every config file — local, global, and
 * `-c` on the command line alike — so an empty one poisons the identity and
 * `git commit` fails with "empty ident name (for <>)". Verified in the running
 * container: `git var GIT_AUTHOR_IDENT` exits non-zero there, and
 * `~/.gitconfig` is an empty file.
 *
 * That is why the operator's own identity has to be applied the same way — as
 * environment overrides — and why writing it into a config file would not
 * work. It is also why `hasIdentity` probes with `git var GIT_AUTHOR_IDENT`
 * rather than reading `user.name`: only that respects the real precedence.
 */

/** The identity to fall back on when nobody has said who is committing. */
export const FALLBACK_IDENTITY: GitIdentity = {
  name: "overseer",
  email: "overseer@localhost",
};

export interface GitIdentity {
  name: string;
  email: string;
}

/** Both halves of git's identity, as the four variables it actually reads. */
export function identityEnv(identity: GitIdentity): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  };
}

/**
 * The env overrides a write operation in `dir` should carry, or `undefined`
 * to inherit whatever git would resolve on its own.
 *
 * 1. The operator configured an identity in settings — always override with
 *    it. It is the most specific answer available, and it has to beat the
 *    empty host variables, which nothing else can.
 * 2. Otherwise, if git can already resolve an identity here, leave it alone:
 *    the repository's own `user.name`/`user.email` is a deliberate choice and
 *    overriding it would silently re-author someone's commits.
 * 3. Otherwise fall back, so a commit succeeds rather than failing on an empty
 *    ident the operator never set.
 */
export async function resolveIdentityEnv(
  dir: string,
  readIdentity: () => Promise<GitIdentity | undefined>,
  hasIdentity: (dir: string) => Promise<boolean>,
): Promise<NodeJS.ProcessEnv | undefined> {
  const configured = await readIdentity();
  if (configured) return identityEnv(configured);
  if (await hasIdentity(dir)) return undefined;
  return identityEnv(FALLBACK_IDENTITY);
}
