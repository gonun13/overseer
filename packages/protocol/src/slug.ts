/**
 * The one shared rule for a workspace folder name, used both to live-derive
 * the folder field from a project name in the UI and to validate the folder
 * a `project.create` request names on the server. Sharing it is what keeps
 * the two from drifting: a folder the client happily auto-filled must never
 * be one the server then rejects.
 *
 * Lowercase alnum and single hyphens only — no separators, no `.`/`..`, no
 * leading dot or underscore. Deliberately the entire pre-creation containment
 * story: `path.join(WORKSPACE_ROOT, folder)` on a string matching this cannot
 * leave the root, which matters because the folder does not exist yet at
 * validation time and so cannot be `realpath`-checked the way an existing
 * project path is (see `isInsideWorkspace` in the server's `workspace.ts`).
 */
export const PROJECT_FOLDER_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Turns a free-typed project name into a candidate folder: strip accents,
 * lowercase, collapse anything not alnum into a single hyphen, trim leading
 * and trailing hyphens. Always produces a string matching
 * `PROJECT_FOLDER_PATTERN`, or empty. */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
