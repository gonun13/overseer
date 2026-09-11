/**
 * The operator's own skills — the folders they imported, not anything a CLI
 * ships with.
 *
 * A skill is a **directory**, and that single fact is what separates this file
 * from `subagent.ts` next door. A subagent is one `.md` file whose entire
 * content fits in a form, so its protocol carries a `prompt` and the editor
 * round-trips it. A skill is a `SKILL.md` plus whatever sits beside it —
 * scripts, references, templates — so there is no field here that holds "the
 * skill". What the operator manipulates is the folder: they import one and
 * they remove one. Hence `SkillImport` rather than `SkillDraft`.
 *
 * Both CLIs this repo drives use the same layout, verified in the container
 * (`claude 2.1.226`, `agent 2026.09.10-fd3934a`):
 *
 *   <dir>/skills/<name>/SKILL.md
 *
 * and both key the skill on the directory name. That is the shape a skill is
 * *installed* in — it is not the only shape one is *written* in. A skill
 * published as a single `<name>.md` carrying the same `name`/`description`
 * frontmatter is the same artifact laid out differently, and the importer
 * accepts it, wrapping it into the folder the CLI expects. What makes a
 * markdown file a skill is the frontmatter, not the filename.
 */

/**
 * Which of the two folders a skill lives in. Project skills ship with the repo
 * and override user ones of the same name; user skills follow the operator
 * across every project. The same precedence subagents take, and the same both
 * CLIs apply.
 */
export type SkillScope = "project" | "user";

/** One skill folder, as an adapter read it off disk. */
export interface Skill {
  /**
   * The frontmatter `name`, falling back to the directory stem. The stem is
   * what both CLIs actually key on, so a disagreement between the two is worth
   * surfacing rather than silently preferring one.
   */
  name: string;
  /** "" when the file has no description. Never invented. */
  description: string;
  scope: SkillScope;
  /** Absolute path to the skill's folder. The provider's layout, not a
   * web-layer guess. */
  dir: string;
  /** Absolute path to the `SKILL.md` inside `dir`. */
  file: string;
  /**
   * Everything else in the folder, relative to `dir`, sorted. This is what
   * makes a skill legible as a directory in a list that has one row per skill:
   * "3 files" is the difference between a skill the operator can reason about
   * and an opaque name.
   */
  files: string[];
  /**
   * Set on a user skill that a project skill of the same name hides. Both are
   * listed: an operator whose import had no effect needs to see why.
   */
  shadowed?: true;
  /**
   * Where this skill was found, when that is *not* the adapter's own config
   * directory — `".claude/skills"` as read by the cursor adapter, say.
   *
   * Cursor's CLI discovers skills under `.claude`, `.codex`, `.grok` and
   * `.agents` as well as its own `.cursor` (verified in the shipped bundle's
   * config-dir table). A skill the CLI will act on has to appear in the list
   * that claims to describe what the CLI will act on — but presenting another
   * provider's folder as this provider's own would be a lie the operator only
   * discovers when a delete does nothing. Absent means "this adapter's own
   * directory", which is the only kind this layer will write to or remove.
   */
  foreign?: string;
  /**
   * Set when `name` does not match `SKILL_NAME_PATTERN`. Listable and
   * deletable, but never a name this layer composes a path from.
   */
  readOnly?: true;
}

/**
 * Where an imported skill comes from.
 *
 * Two sources, because they are the two an operator actually has: a skill
 * someone published, and a file on their own machine. Neither carries a
 * destination — that is `SkillImport.scope`, resolved by the adapter, for the
 * same reason `SubagentDraft` carries no `file`.
 */
export type SkillSource =
  /**
   * A git repository, optionally a ref and a path within it. The server clones
   * it; the operator never names a local path, so no filesystem string they
   * supply is ever joined onto anything.
   */
  | { kind: "git"; url: string; ref?: string; subpath?: string }
  /**
   * Files read in the operator's browser and sent as text. Skills are markdown,
   * so this rides the existing JSON socket rather than justifying a whole
   * upload transport.
   *
   * `path` is relative to the skill's own folder (`SKILL.md`,
   * `references/api.md`) — never absolute, never containing `..`, enforced on
   * the wire and again by the server before anything is written.
   */
  | { kind: "upload"; files: SkillUploadFile[] };

export interface SkillUploadFile {
  path: string;
  text: string;
}

/**
 * What one import produced.
 *
 * Plural because one source can hold many: a repository folder of flat
 * `<name>.md` skills installs all of them, which is the shape published
 * collections actually take. A single-skill source is the same type with one
 * entry, so nothing downstream needs two code paths.
 *
 * `skipped` is not an error list. A folder re-imported after one new skill was
 * added should install that one and say plainly that the rest were already
 * there — reporting that as a failure would make the ordinary case look broken.
 */
export interface SkillImportOutcome {
  imported: Skill[];
  skipped: SkillSkipped[];
}

export interface SkillSkipped {
  /** The skill's own name where it had one, else the file it came from. */
  name: string;
  reason: string;
}

/** What the import form submits. */
export interface SkillImport {
  source: SkillSource;
  scope: SkillScope;
  /**
   * Overrides the name the skill would otherwise give itself. Absent means
   * "use what the skill calls itself", which is the ordinary case — and the
   * only possibility when the source holds more than one, since a single name
   * cannot stand for several skills.
   */
  name?: string;
}
