/**
 * Claude Code names session directories under `~/.claude/projects/` by
 * replacing every non-alphanumeric character with a single hyphen. The mapping
 * is lossy — recover the real cwd from JSONL metadata, never by decoding.
 */
export function projectDirSlug(projectDir: string): string {
  return projectDir.replace(/[^A-Za-z0-9]/g, "-");
}
