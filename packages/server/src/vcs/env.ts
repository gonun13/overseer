/**
 * Which identity a commit this app makes is authored under.
 *
 * The precedence here is not arbitrary, and it is not git's. Git reads
 * `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` and the `GIT_COMMITTER_*` pair ahead
 * of every config file — local, global, and `-c` on the command line alike —
 * so an *empty* one poisons the identity outright and `git commit` fails with
 * "empty ident name (for <>)". The compose files used to hand exactly that
 * down: `${VAR:-}` turned "the host set none" into an empty string in the
 * container, which beat both the identity saved in settings and the
 * container's own `~/.gitconfig`. They pass these by bare name now, so an
 * unset variable stays unset, and `dropEmptyIdentityEnv` below is the backstop
 * for a stack started some other way.
 *
 * The operator's own identity is still applied as environment overrides rather
 * than written to a config file, because that is the only layer that beats an
 * empty variable if one does slip through. It is also why `hasIdentity` probes
 * with `git var GIT_AUTHOR_IDENT` rather than reading `user.name`: only that
 * respects the real precedence.
 */

/** The four variables git resolves an identity from, ahead of any config. */
export const IDENTITY_VARS = [
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
] as const;

/**
 * Drop identity variables that arrived empty, once, at boot.
 *
 * An empty one is worse than nothing: git prefers it over every config file
 * and then fails with "empty ident name (for <>)", so a perfectly good
 * `~/.gitconfig` or repository config is overridden by a value nobody set.
 * The compose files no longer produce them — bare-name passthrough leaves an
 * unset variable unset — but a stack brought up by hand, or a host that
 * exports one as empty, still can.
 *
 * Every child process inherits this environment — the agent's own sessions,
 * the console, the dev loop — so removing them here is what lets a config file
 * work at all for anything the server did not spawn with explicit overrides.
 * A *non-empty* value is left alone: that is a host that meant it.
 */
export function dropEmptyIdentityEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const dropped: string[] = [];
  for (const name of IDENTITY_VARS) {
    if (env[name] === "") {
      delete env[name];
      dropped.push(name);
    }
  }
  return dropped;
}

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
