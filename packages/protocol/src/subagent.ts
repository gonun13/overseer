/**
 * The operator's own subagents — the `.md` files they wrote, not the built-in
 * routing agents a CLI ships with.
 *
 * `ProviderOptions.agents` already carries these, but only as menu rows
 * (`value`/`label`/`detail`): enough to pick one, not enough to edit one. This
 * is the fuller shape the capabilities window needs — the body, where the file
 * lives, and which of the two folders it came from.
 */

/**
 * Which of the two folders a subagent lives in. Project agents ship with the
 * repo and override user ones of the same name; user agents follow the
 * operator across every project. Exactly the CLI's own precedence.
 */
export type SubagentScope = "project" | "user";

/** One subagent file, as an adapter read it off disk. */
export interface Subagent {
  /**
   * The frontmatter `name`, falling back to the filename stem — the CLI's own
   * precedence. This, not the filename, is what a session's `agent` carries.
   */
  name: string;
  /** "" when the file has no description. Never invented. */
  description: string;
  /** The markdown after the frontmatter block, verbatim. */
  prompt: string;
  /** "" means the subagent inherits the session's model. */
  model: string;
  /**
   * The frontmatter `tools` line as written — a comma-separated allowlist.
   * "" means inherit every tool the session has, which is not the same as an
   * empty allowlist, so the two must stay distinguishable on the way back out.
   */
  tools: string;
  scope: SubagentScope;
  /** Absolute path. The provider's layout, not a web-layer guess. */
  file: string;
  /**
   * Set on a user agent that a project agent of the same name hides. Both are
   * listed: an operator whose edit had no effect needs to see why.
   */
  shadowed?: true;
  /**
   * Set when the frontmatter name disagrees with the filename stem. Saving
   * renames the file to `<name>.md`, so the form warns before it does.
   */
  renamedOnSave?: true;
  /**
   * Set when `name` does not match `SUBAGENT_NAME_PATTERN`. Listable and
   * deletable, but not writable: the name is the filename, and a name this
   * layer cannot safely compose a path from is one it must not write to.
   */
  readOnly?: true;
}

/**
 * What the editor submits.
 *
 * Deliberately carries no `file`: where it lands is derived from `scope` and
 * `name`, and letting a client name a path would hand it the containment
 * decision (the same reasoning `project.create` takes a folder, not a path).
 */
export interface SubagentDraft {
  name: string;
  description: string;
  prompt: string;
  model: string;
  tools: string;
  scope: SubagentScope;
}
