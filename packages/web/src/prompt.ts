/** The bottom-left menu. Every row here changes what the *next* prompt does —
 * it is the prompt's control surface, not a nav menu (design-system.md §6).
 *
 * Types only. Which models, modes and subagents an instance actually offers is
 * a fact about that instance — it comes from the provider and the project's
 * config, not from this file. Until the provider can report them the control
 * surface stays empty instead of inventing an option set. */

export type PromptOptionKey = "model" | "mode" | "agent";

export interface PromptOption {
  key: PromptOptionKey;
  label: string;
  /** Listed in the accordion section; the operator picks one. */
  values: string[];
  /** Values that arm something dangerous get the accent treatment. */
  danger?: string[];
}

/** Empty string means "the provider has not told us yet" — never a stand-in value. */
export type PromptSettings = Record<PromptOptionKey, string>;

/** What a session is armed with before the provider has reported anything. */
export const BLANK_PROMPT_SETTINGS: PromptSettings = {
  model: "",
  mode: "",
  agent: "",
};
