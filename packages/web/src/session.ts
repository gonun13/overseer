/** Session controls in a session window. Every row here changes what the
 * *next* turn of that session does — not a nav menu (design-system.md §6).
 *
 * Types only. Which models, modes and subagents an instance actually offers is
 * a fact about that instance — it comes from the provider and the project's
 * config, not from this file. The rows are always shown; only their value
 * lists fill in once the provider reports them. */

import type { ProviderOption, ProviderOptions } from "@overseer/protocol";

export type SessionOptionKey = "model" | "mode" | "agent";

export interface SessionOption {
  key: SessionOptionKey;
  label: string;
  /** Listed in the accordion section; the operator picks one. */
  values: ProviderOption[];
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

/**
 * Fill the rows in from what the provider reported. Rows whose list is still
 * empty stay empty — the accordion then refuses to open that section, which is
 * the honest state for "we have not been told".
 */
export function sessionOptionsFrom(
  reported: ProviderOptions | undefined,
): SessionOption[] {
  if (reported === undefined) return SESSION_CONTROL_OPTIONS;
  return SESSION_CONTROL_OPTIONS.map((option) => ({
    ...option,
    values:
      option.key === "model"
        ? reported.models
        : option.key === "mode"
          ? reported.permissionModes
          : reported.agents,
  }));
}

/**
 * The label to print on a control head. Whatever the menu marks as current is
 * what the head must say — the agent row's "none" has value `""`, so an unset
 * agent and a chosen "none" are one state and must read as one word.
 */
export function labelForValue(
  option: SessionOption,
  value: string,
): string | undefined {
  const match = option.values.find((candidate) => candidate.value === value);
  if (match !== undefined) return match.label;
  // Fall back to the raw value: a live session can be running a model that is
  // no longer in the menu, and showing it is better than showing nothing.
  return value === "" ? undefined : value;
}

/**
 * The same label, narrowed for a head. Four heads share the width of the
 * composer, so a trailing parenthetical — the CLI's "Default (recommended)" —
 * would spend the whole column on an annotation and then ellipsize the part
 * that identifies it. The full label still stands in the menu and on the
 * button's accessible name; only the visible head is trimmed.
 */
export function headLabel(
  option: SessionOption,
  value: string,
): string | undefined {
  const label = labelForValue(option, value);
  if (label === undefined) return undefined;
  const trimmed = label.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return trimmed === "" ? label : trimmed;
}
