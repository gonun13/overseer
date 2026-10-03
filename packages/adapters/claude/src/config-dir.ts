/**
 * Where this CLI keeps its own state — credentials, settings, and the
 * operator's user-level `agents/` folder.
 *
 * Its own module because three call sites now need it (the options probe's
 * spawn env, the options read, and the subagent files), and a default that
 * disagrees between two of them is a bug that only shows up on a machine where
 * `HOME` is unset.
 */
export function configDir(): string {
  return (
    process.env.CLAUDE_CONFIG_DIR ??
    `${process.env.HOME ?? "/home/node"}/.claude`
  );
}
