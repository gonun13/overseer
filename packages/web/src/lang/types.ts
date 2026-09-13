import type { SpaceMessageKey } from "@overseer/protocol";

/**
 * Overseer copy. Personality may change *how* a message reads, never *what* a
 * signal or operation reports (docs/overseer-behavior.md §2.3). Each tone file
 * is a full set; `message()` falls back to neutral for any missing key.
 *
 * Keyed off the protocol's `SpaceMessageKey` so the server cannot name a line
 * the packs do not hold, and a pack cannot grow a line nothing can ask for.
 */
export type OverseerTone = "neutral" | "dry" | "warm";

export type OverseerMessages = Record<SpaceMessageKey, string> & {
  /** Boot beat while the minimum timer runs. */
  starting: string;
  /** Boot beat past the minimum, still waiting on the socket. */
  connecting: string;
  /** Self-introduction — message behind the tone pick, not a solo beat. */
  intro: string;
  /** Prefix on the name ask: `welcome... [_____]?` */
  namePrefix: string;
  /** Message while the tone picker is up. */
  tonePrompt: string;
  /** First greet after the name is known. `{name}` is substituted. */
  welcome: string;
  /** Return-visit greet. `{name}` is substituted. */
  welcomeBack: string;
  /** Discovery pass in flight. */
  lookingAround: string;
  /** The reset decision is up and the overseer has read it. This is the one
   * message that is about the overseer rather than about the work. */
  resetAsk: string;
  /** The operator answered no. */
  resetDeclined: string;
  /** The wipe is running and the furniture is going. */
  resetWorking: string;
  /** Last line before the reload. Nothing follows it. */
  resetGoodbye: string;

  // Steady state — one per `Activity`, chosen from the top-ranked signal via
  // `ACTIVITY_MESSAGE_KEY`. These are what replaced the single uppercase
  // activity word: the words carry the voice, and the status light beside
  // them carries the severity.
  /** Nothing running, nothing wrong. */
  idle: string;
  /** Work finished and waiting to be looked at. */
  ready: string;
  /** Something is in motion. */
  working: string;
  /** Progress has stopped until the operator does something. */
  blocked: string;
  /** Something went wrong and is not going to fix itself. */
  attention: string;
  /** A session is sitting on a permission request. */
  approval: string;

  // Reactions the server raises through `space.say()`. `{provider}` is
  // substituted.
  /** A provider that was signed out is signed in again. */
  authRestored: string;
  /** A credential stopped working. */
  authLost: string;
};

export type MessageKey = SpaceMessageKey;
