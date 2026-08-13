import type {
  AppliedPersonality,
  RejectedCustomization,
} from "@overseer/protocol";

/**
 * Pure allowlist policy for `personality.json`.
 *
 * Anything not named here is refused by default. An allowlist that accepts the
 * unrecognised is not an allowlist. No filesystem, git, or action-log side
 * effects — callers decide how to report refusals.
 */

export type PersonalityTone = NonNullable<AppliedPersonality["tone"]>;

/** Fields the operator may set, and how each is validated. */
export const TONES = new Set<string>(["neutral", "dry", "warm"]);
/** A headline, not a paragraph. Long enough to be personal, short enough to
 * stay one line at 34px (design-system.md §4). */
export const MAX_GREETING = 48;
export const MAX_NAME = 24;
/** Cap, not a free dial: past this the "rare tell" stops being rare and starts
 * being a scheduled effect (design-system.md §9). */
export const MAX_TYPING_CHANCE = 0.5;

/**
 * Why each refused field is refused, in the operator's terms. Keyed by the
 * field name a user is most likely to reach for; the catch-all in
 * `validatePersonalityObject` covers the rest.
 */
const FORBIDDEN: Record<string, string> = {
  logging: "logging is internal · the overseer's record is not editable",
  logLevel: "logging is internal · the overseer's record is not editable",
  disableLogging: "logging is internal · the overseer's record is not editable",
  actions: "the action register is an audit trail and cannot be filtered",
  actionRegister: "the action register is an audit trail and cannot be filtered",
  hideActions: "the action register is an audit trail and cannot be filtered",
  permissions: "permissions belong to the permission system, not to a config file",
  allowedTools: "permissions belong to the permission system, not to a config file",
  auth: "authentication is not configurable from the workspace",
  workspaceRoot: "paths and mounts are deployment facts, not preferences",
  internalDir: "paths and mounts are deployment facts, not preferences",
  paths: "paths and mounts are deployment facts, not preferences",
  signals: "signals are derived from real state · editable signals are fiction",
  signalRanking: "signals are derived from real state · editable signals are fiction",
  headlines: "the state vocabulary is fixed; tone is customizable, meaning is not",
};

export function parseOperatorName(
  rawName: string,
): { ok: true; name: string } | { ok: false; reason: string } {
  const name = rawName.trim();
  if (!name || name.length > MAX_NAME) {
    return {
      ok: false,
      reason: `expected a non-empty string of at most ${MAX_NAME} characters`,
    };
  }
  return { ok: true, name };
}

export function parseOperatorTone(
  tone: string,
): { ok: true; tone: PersonalityTone } | { ok: false; reason: string } {
  if (!TONES.has(tone)) {
    return {
      ok: false,
      reason: `expected one of ${[...TONES].join(", ")}`,
    };
  }
  return { ok: true, tone: tone as PersonalityTone };
}

/** Shared allowlist walk used by both the discovery read and the connect peek. */
export function validatePersonalityObject(parsed: Record<string, unknown>): {
  applied: AppliedPersonality;
  rejected: RejectedCustomization[];
} {
  const applied: AppliedPersonality = {};
  const rejected: RejectedCustomization[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    // Comment keys are a convention in hand-edited JSON; ignoring them silently
    // is right because the operator did not intend them as customization.
    if (key.startsWith("//") || key === "$schema") continue;

    const forbidden = FORBIDDEN[key];
    if (forbidden) {
      rejected.push({ field: key, reason: forbidden });
      continue;
    }

    switch (key) {
      case "tone": {
        if (typeof value === "string" && TONES.has(value)) {
          applied.tone = value as AppliedPersonality["tone"];
        } else {
          rejected.push({
            field: "tone",
            reason: `expected one of ${[...TONES].join(", ")}`,
          });
        }
        break;
      }
      case "name": {
        if (typeof value === "string" && value.trim() && value.length <= MAX_NAME) {
          applied.name = value.trim();
        } else {
          rejected.push({
            field: "name",
            reason: `expected a non-empty string of at most ${MAX_NAME} characters`,
          });
        }
        break;
      }
      case "greeting": {
        if (
          typeof value === "string" &&
          value.trim() &&
          value.length <= MAX_GREETING
        ) {
          applied.greeting = value.trim();
        } else {
          rejected.push({
            field: "greeting",
            reason: `expected a non-empty string of at most ${MAX_GREETING} characters · it is a headline, not a paragraph`,
          });
        }
        break;
      }
      case "typingChance": {
        if (
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0 &&
          value <= MAX_TYPING_CHANCE
        ) {
          applied.typingChance = value;
        } else {
          rejected.push({
            field: "typingChance",
            reason: `expected a number between 0 and ${MAX_TYPING_CHANCE}`,
          });
        }
        break;
      }
      default:
        rejected.push({
          field: key,
          reason: "not a customizable field · see docs/overseer.md §6.4",
        });
    }
  }

  return { applied, rejected };
}
