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

/**
 * The one shared rule for a subagent name, used both to validate what the
 * editor submits and to compose the file it lands in.
 *
 * Deliberately a separate constant rather than an alias of
 * `PROJECT_FOLDER_PATTERN`: that one governs a directory in the workspace,
 * this one a `<name>.md` inside an agents folder, and the two are free to
 * diverge. Kebab-case is also what Claude Code's own agents use.
 *
 * As with the folder rule, this is the entire pre-creation containment story:
 * the file does not exist at validation time and so cannot be `realpath`-
 * checked, but `path.join(agentsDir, `${name}.md`)` on a string matching this
 * has no separators and no `.`/`..`, and cannot leave the folder.
 */
export const SUBAGENT_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The one shared rule for a skill name.
 *
 * A third constant with the same body as the two above, for the same reason
 * they are separate from each other: this one governs a *directory* inside a
 * skills folder, holding a `SKILL.md` and whatever files sit beside it. A
 * skill's name is its directory name in both CLIs this repo drives — verified
 * against `claude 2.1.226` and `agent 2026.09.10-fd3934a`, which each key a
 * skill on the folder it lives in.
 *
 * It carries the same containment weight as its siblings, and one more job
 * besides. The directory does not exist at validation time, so it cannot be
 * `realpath`-checked; a string matching this has no separators and no
 * `.`/`..`, so `path.join(skillsDir, name)` cannot leave the folder. The extra
 * job is that an *imported* skill's name can come from a git URL or an
 * uploaded file's path rather than from a form the operator typed — input this
 * layer never saw being composed — which is exactly when a shape rule stops
 * being a nicety.
 */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
