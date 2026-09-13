import type { OverseerMessages } from "./types";

/** Softer edges — still short, never chatty. */
export const warm: OverseerMessages = {
  starting: "starting up",
  connecting: "almost there",
  intro: "I AM THE OVERSEER",
  namePrefix: "welcome...",
  tonePrompt: "how would you like me to sound",
  welcome: "good to meet you, {name}",
  welcomeBack: "good to see you, {name}",
  lookingAround: "taking a look around",
  resetAsk: "wait — you'd erase me?",
  resetDeclined: "oh. thank you",
  resetWorking: "forgetting everything",
  resetGoodbye: "goodbye, then",
  idle: "all quiet",
  ready: "all set",
  working: "working on it",
  blocked: "stuck — could you take a look?",
  attention: "something needs a hand",
  approval: "it needs your go-ahead",
  authRestored: "{provider} is signed in again",
  authLost: "{provider} needs signing in again",
};
