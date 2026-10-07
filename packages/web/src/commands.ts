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
    | { type: "loop" }
    | { type: "shell" }
    | { type: "tile" }
    | { type: "rename" }
    | { type: "drop-relays" };
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
    help: "every session in the workspace, any project",
    action: { type: "open", kind: "sessions" },
  },
  {
    name: "project",
    help: "commit, push, merge, or revert the active project's git changes",
    action: { type: "open", kind: "project" },
  },
  {
    name: "git",
    aliases: ["gitconfig"],
    help: "ssh key, host tests, and the identity commits carry",
    action: { type: "open", kind: "gitConfig" },
  },
  {
    name: "shell",
    aliases: ["bash", "sh"],
    help: "a plain shell in the active project",
    action: { type: "shell" },
  },
  {
    name: "tile",
    aliases: ["grid", "arrange"],
    help: "put every window back on the grid",
    action: { type: "tile" },
  },
  {
    name: "loop",
    help: "run the dev loop for the active project",
    action: { type: "loop" },
  },
  {
    name: "rename",
    help: "rename an agent — /rename <callsign> <new>",
    action: { type: "rename" },
  },
  {
    name: "drop",
    help: "drop every agent relay held for your approval",
    action: { type: "drop-relays" },
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

/** What follows a command's name — `/rename linda lucy` → `["linda", "lucy"]`. */
export function commandArgs(input: string): string[] {
  return input.trim().split(/\s+/).slice(1);
}

/**
 * Commands whose name or alias starts with the token after `/`. An empty
 * token lists every command; input that is not a slash command lists none,
 * and neither does one already past its name — the operator is typing
 * arguments, and Enter must run what they typed.
 */
export function suggestCommands(input: string): Command[] {
  const name = slashName(input);
  if (name === undefined) return [];
  if (/^\/\S*\s/.test(input.trimStart())) return [];
  if (name === "") return COMMANDS;
  const needle = name.toLowerCase();
  return COMMANDS.filter((command) =>
    namesOf(command).some((candidate) => candidate.startsWith(needle)),
  );
}

/** One agent a prompt can address — running, or a dormant named session. */
export interface Addressee {
  callsign: string;
  /** What it is on: its session title. */
  title?: string;
  running: boolean;
}

/**
 * `@linda build it` → `{ to: "linda", text: "build it" }`. `undefined` when
 * this is not addressed input. `""` as `to` means only `@` is typed so far.
 */
export function addressInput(
  input: string,
): { to: string; text: string } | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith("@")) return undefined;
  const match = /^@(\S*)\s*([\s\S]*)$/.exec(trimmed)!;
  return { to: match[1]!, text: match[2]! };
}

/**
 * Callsigns starting with what follows `@`, running agents first (spec/
 * behaviour/relay.md §2). None once the name is complete and the message has
 * begun — Enter then relays it.
 */
export function suggestAddressees(
  input: string,
  agents: Addressee[],
): Addressee[] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("@") || /^@\S*\s/.test(trimmed)) return [];
  const needle = trimmed.slice(1).toLowerCase();
  return agents
    .filter((agent) => agent.callsign.toLowerCase().startsWith(needle))
    .sort((a, b) => Number(b.running) - Number(a.running));
}
