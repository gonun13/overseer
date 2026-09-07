import type { WindowKind } from "./windows";

export interface Command {
  /** Canonical name, matched after a leading `/`. Shown in autocomplete. */
  name: string;
  aliases?: readonly string[];
  help: string;
  action:
    | { type: "open"; kind: WindowKind }
    | { type: "settings" }
    | { type: "selector" }
    | { type: "theme" }
    | { type: "close-all" }
    | { type: "loop" };
}

export const COMMANDS: Command[] = [
  {
    name: "providers",
    aliases: ["provider"],
    help: "choose which provider is attached",
    action: { type: "open", kind: "providers" },
  },
  {
    name: "sessions",
    aliases: ["session"],
    help: "list sessions",
    action: { type: "open", kind: "sessions" },
  },
  {
    name: "plans",
    aliases: ["plan"],
    help: "plans built in this project's sessions",
    action: { type: "open", kind: "plans" },
  },
  {
    name: "project",
    help: "commit, push, merge, or revert the active project's git changes",
    action: { type: "open", kind: "project" },
  },
  {
    name: "capabilities",
    aliases: ["mcp", "skills", "subagents", "agents"],
    help: "mcp servers, skills, subagents",
    action: { type: "open", kind: "capabilities" },
  },
  {
    name: "console",
    aliases: ["term", "terminal", "shell"],
    help: "raw terminal into the provider cli",
    action: { type: "open", kind: "console" },
  },
  {
    name: "loop",
    help: "run the dev loop for the active project",
    action: { type: "loop" },
  },
  {
    name: "settings",
    aliases: ["system"],
    help: "auth, runtime, workspace, git access, theme",
    action: { type: "settings" },
  },
  {
    name: "help",
    help: "this window",
    action: { type: "open", kind: "help" },
  },
  {
    name: "changelog",
    aliases: ["changes", "whatsnew"],
    help: "what changed in each release",
    action: { type: "open", kind: "changelog" },
  },
  {
    name: "theme",
    aliases: ["night", "day"],
    help: "switch theme",
    action: { type: "theme" },
  },
  {
    name: "clear",
    aliases: ["dismiss"],
    help: "dismiss all windows",
    action: { type: "close-all" },
  },
];

function namesOf(command: Command): string[] {
  return [command.name, ...(command.aliases ?? [])].map((name) =>
    name.toLowerCase(),
  );
}

/**
 * The first token after a leading `/`, or `undefined` when this is not a
 * command. `""` means the operator has typed `/` and nothing else yet.
 */
export function slashName(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return undefined;
  return trimmed.slice(1).split(/\s+/, 1)[0] ?? "";
}

/** Exact name or alias match on the first token after `/`. */
export function matchCommand(input: string): Command | undefined {
  const name = slashName(input);
  if (name === undefined || name === "") return undefined;
  const needle = name.toLowerCase();
  return COMMANDS.find((command) => namesOf(command).includes(needle));
}

/**
 * Commands whose name or alias starts with the token after `/`. An empty
 * token lists every command; input that is not a slash command lists none.
 */
export function suggestCommands(input: string): Command[] {
  const name = slashName(input);
  if (name === undefined) return [];
  if (name === "") return COMMANDS;
  const needle = name.toLowerCase();
  return COMMANDS.filter((command) =>
    namesOf(command).some((candidate) => candidate.startsWith(needle)),
  );
}
