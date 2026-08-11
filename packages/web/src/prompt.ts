/** The bottom-left menu. Every row here changes what the *next* prompt does —
 * it is the prompt's control surface, not a nav menu (design-system.md §6). */

export type PromptOptionKey = "model" | "mode" | "agent";

export interface PromptOption {
  key: PromptOptionKey;
  label: string;
  /** Listed in the accordion section; the operator picks one. */
  values: string[];
  /** Values that arm something dangerous get the accent treatment. */
  danger?: string[];
}

export const PROMPT_OPTIONS: PromptOption[] = [
  { key: "model", label: "model", values: ["opus-5", "sonnet-5", "haiku-4.5"] },
  {
    key: "mode",
    label: "mode",
    values: ["ask", "auto-accept", "plan", "bypass"],
    danger: ["bypass"],
  },
  {
    key: "agent",
    label: "agent",
    values: ["default", "developer", "tech-lead", "project-manager"],
  },
];

export type PromptSettings = Record<PromptOptionKey, string>;

export const DEFAULT_PROMPT_SETTINGS: PromptSettings = {
  model: "opus-5",
  mode: "ask",
  agent: "default",
};
