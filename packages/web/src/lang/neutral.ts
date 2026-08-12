import type { OverseerMessages } from "./types";

/** Default register — plain, telegraphic, no attitude. */
export const neutral: OverseerMessages = {
  starting: "starting",
  connecting: "connecting",
  intro: "I AM THE OVERSEER",
  namePrefix: "welcome...",
  tonePrompt: "how should I speak",
  welcome: "welcome, {name}",
  welcomeBack: "welcome back, {name}",
  lookingAround: "looking around",
};
