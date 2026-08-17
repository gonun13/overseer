/** Session controls in a session window. Every row here changes what the
 * *next* turn of that session does — not a nav menu (design-system.md §6).
 *
 * Types only. Which models, modes and subagents an instance actually offers is
 * a fact about that instance — it comes from the provider and the project's
 * config, not from this file. The rows are always shown; only their value
 * lists fill in once the provider reports them. */

export type SessionOptionKey = "model" | "mode" | "agent";

export interface SessionOption {
  key: SessionOptionKey;
  label: string;
  /** Listed in the accordion section; the operator picks one. */
  values: string[];
  /** Values that arm something dangerous get the accent treatment. */
  danger?: string[];
}

/** Empty string means "the provider has not told us yet" — never a stand-in value. */
export type SessionSettings = Record<SessionOptionKey, string>;

/** What a session is armed with before the provider has reported anything. */
export const BLANK_SESSION_SETTINGS: SessionSettings = {
  model: "",
  mode: "",
  agent: "",
};

/** Rows that every session window shows. Value lists start empty. */
export const SESSION_CONTROL_OPTIONS: SessionOption[] = [
  { key: "model", label: "model", values: [] },
  { key: "mode", label: "mode", values: [] },
  { key: "agent", label: "agent", values: [] },
];

export const SESSION_CONTROL_KEYS: SessionOptionKey[] =
  SESSION_CONTROL_OPTIONS.map((option) => option.key);
