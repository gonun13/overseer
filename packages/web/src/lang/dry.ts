import type { OverseerMessages } from "./types";

/** Spare, a little flat — personality without warmth. */
export const dry: OverseerMessages = {
  starting: "starting",
  connecting: "still connecting",
  intro: "I AM THE OVERSEER",
  namePrefix: "name...",
  tonePrompt: "tone",
  welcome: "ah. {name}",
  welcomeBack: "you again, {name}",
  lookingAround: "looking",
  resetAsk: "erase me. really.",
  resetDeclined: "thought not",
  resetWorking: "deleting myself",
  resetGoodbye: "well. bye.",
  idle: "nothing. as usual",
  ready: "done. for now",
  working: "busy",
  blocked: "stuck. your move",
  attention: "this went badly",
  approval: "it wants permission",
  authRestored: "{provider} remembered who it is",
  authLost: "{provider} forgot its credential",
};
