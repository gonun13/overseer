import type { WindowKind } from "./windows";

export interface Command {
  /** Matched case-insensitively against the whole input. */
  pattern: RegExp;
  usage: string;
  help: string;
  action:
    | { type: "open"; kind: WindowKind }
    | { type: "settings" }
    | { type: "selector" }
    | { type: "theme" }
    | { type: "close-all" };
}

export const COMMANDS: Command[] = [
  {
    pattern: /^adapters?$/i,
    usage: "adapters",
    help: "choose which adapter is attached",
    action: { type: "open", kind: "adapters" },
  },
  {
    pattern: /^sessions?$/i,
    usage: "sessions",
    help: "list sessions",
    action: { type: "open", kind: "sessions" },
  },
  {
    pattern: /^(projects?|switch)$/i,
    usage: "projects",
    help: "open the project selector",
    action: { type: "selector" },
  },
  {
    pattern: /^approvals?$/i,
    usage: "approvals",
    help: "pending approval queue",
    action: { type: "open", kind: "approvals" },
  },
  {
    pattern: /^(capabilities|mcp|skills)$/i,
    usage: "capabilities",
    help: "mcp servers, skills, subagents",
    action: { type: "open", kind: "capabilities" },
  },
  {
    pattern: /^context$/i,
    usage: "context",
    help: "what rides along with the prompt",
    action: { type: "open", kind: "context" },
  },
  {
    pattern: /^(console|term|terminal|shell)$/i,
    usage: "console",
    help: "raw terminal into the adapter cli",
    action: { type: "open", kind: "console" },
  },
  {
    pattern: /^(system|settings)$/i,
    usage: "settings",
    help: "auth, runtime, workspace, theme",
    action: { type: "settings" },
  },
  {
    pattern: /^help$/i,
    usage: "help",
    help: "this window",
    action: { type: "open", kind: "help" },
  },
  {
    pattern: /^(night|day|theme)$/i,
    usage: "theme",
    help: "switch theme",
    action: { type: "theme" },
  },
  {
    pattern: /^(clear|dismiss)$/i,
    usage: "clear",
    help: "dismiss all windows",
    action: { type: "close-all" },
  },
];

export function matchCommand(input: string): Command | undefined {
  const trimmed = input.trim();
  return COMMANDS.find((c) => c.pattern.test(trimmed));
}
