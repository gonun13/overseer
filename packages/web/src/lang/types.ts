/**
 * Overseer copy. Personality may change *how* a headline reads, never *what*
 * a signal or operation reports (docs/overseer.md §2.3). Each tone file is a
 * full set; `message()` falls back to neutral for any missing key.
 */
export type OverseerTone = "neutral" | "dry" | "warm";

export interface OverseerMessages {
  /** Boot beat while the minimum timer runs. */
  starting: string;
  /** Boot beat past the minimum, still waiting on the socket. */
  connecting: string;
  /** First-turn self-introduction. */
  intro: string;
  /** Prefix on the name ask: `welcome... [_____]?` */
  namePrefix: string;
  /** Headline while the tone picker is up. */
  tonePrompt: string;
  /** First greet after the name is known. `{name}` is substituted. */
  welcome: string;
  /** Return-visit greet. `{name}` is substituted. */
  welcomeBack: string;
  /** Discovery pass in flight. */
  lookingAround: string;
}

export type MessageKey = keyof OverseerMessages;
