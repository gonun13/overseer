/** Session controls in a session window. Every row here changes what the
 * *next* turn of that session does — not a nav menu (design-system.md §6).
 *
 * Types only. Which models, modes and subagents an instance actually offers is
 * a fact about that instance — it comes from the provider and the project's
 * config, not from this file. The rows are always shown; only their value
 * lists fill in once the provider reports them. */

import type { ProviderOption, ProviderOptions } from "@overseer/protocol";
import type { Session } from "./domain";

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
  const match = findOption(option.values, value);
  if (match !== undefined) return match.label;
  // Fall back to the raw value: a live session can be running a model that is
  // no longer in the menu, and showing it is better than showing nothing.
  return value === "" ? undefined : value;
}

/**
 * Match a row's live value back to its catalog entry. A model row's `value`
 * is the menu's own wire id (`"haiku"`); once a session is actually running
 * one, `SessionMeta.model` and per-turn attribution carry the CLI's
 * *resolved* id instead (`"claude-haiku-4-5-20251001"`) — so a plain `value`
 * match alone would miss every live model and fall through to printing the
 * raw resolved id. Mode and agent rows carry no `resolvedModel`, so this is a
 * no-op for them.
 *
 * `"default"` is excluded from the `resolvedModel` search: it means
 * "whatever the account resolves to" and so shares its `resolvedModel` with
 * whichever concrete entry the account currently defaults to (`"sonnet"`,
 * today) — matching it first would report every live Sonnet turn as
 * "Default" even when the operator picked "Sonnet 5" by name. A concrete
 * entry is always the more truthful read of a live id; `"default"` is only
 * ever the right answer for an exact `value` match (row still reads "not
 * set" / "unset"), never for resolving a reported model back.
 */
export function findOption(
  values: ProviderOption[],
  value: string,
): ProviderOption | undefined {
  const exact = values.find((candidate) => candidate.value === value);
  if (exact !== undefined) return exact;
  return values.find(
    (candidate) => candidate.value !== "default" && candidate.resolvedModel === value,
  );
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

/**
 * Whether a stop would actually reach this session. Two conditions, both
 * necessary: a turn has to be in flight (`interrupt` on an idle session is a
 * refusal from the supervisor, not a no-op), and the session has to be one the
 * supervisor owns. A dev-loop run is not — its CLI is leased to a console of
 * its own, which is why the row withholds delete from it as well.
 */
export function isStoppable(session: Session): boolean {
  return session.activity === "working" && session.origin !== "loop";
}

/** The same read over a list — what `stop all sessions` sweeps. */
export function stoppableSessions(sessions: Session[]): Session[] {
  return sessions.filter(isStoppable);
}
