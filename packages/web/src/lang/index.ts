import { dry } from "./dry";
import { neutral } from "./neutral";
import { warm } from "./warm";
import type {
  MessageKey,
  OverseerMessages,
  OverseerTone,
} from "./types";

export type { MessageKey, OverseerMessages, OverseerTone } from "./types";

const BY_TONE: Record<OverseerTone, OverseerMessages> = {
  neutral,
  dry,
  warm,
};

/** Resolve a line for the active tone. Unknown tones fall back to neutral.
 * `{name}` (and any other `{key}`) is replaced from `vars`. */
export function message(
  tone: OverseerTone | undefined,
  key: MessageKey,
  vars?: Record<string, string>,
): string {
  const pack = BY_TONE[tone ?? "neutral"] ?? neutral;
  const template = pack[key] || neutral[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? "");
}

export function messagesFor(
  tone: OverseerTone | undefined,
): OverseerMessages {
  return BY_TONE[tone ?? "neutral"] ?? neutral;
}
