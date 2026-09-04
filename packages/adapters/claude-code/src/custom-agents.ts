import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  SUBAGENT_NAME_PATTERN,
  type ProviderOption,
  type Subagent,
  type SubagentScope,
} from "@overseer/protocol";

/**
 * The operator's own subagents — the `.md` files they wrote into an `agents`
 * folder, not the built-ins the CLI ships with.
 *
 * The `initialize` control response lists both together with nothing to tell
 * them apart, and its built-ins (`Explore`, `Plan`, `general-purpose`, …) are
 * the CLI's internal routing, not a choice the operator made. Offering them
 * here would put Claude's own machinery in a menu next to the modes. So this
 * reads the two directories the operator actually writes to:
 *
 *   <project>/.claude/agents/*.md   — this project
 *   $CLAUDE_CONFIG_DIR/agents/*.md  — every project
 *
 * Project wins on a name collision, which is the CLI's own precedence.
 *
 * Never throws: a missing folder is the ordinary case (most operators have
 * none), and an unreadable one reports no agents rather than failing the row.
 *
 * There is one directory walk here, not two. `readSubagents` is the full read
 * — body, path, scope, both sides of a collision — and `readCustomAgents` is a
 * projection of it down to menu rows. Two walkers would be two copies of the
 * precedence rule, free to drift.
 */

/** The row entry for "no subagent" — the agent runs the turn itself. */
export const NO_AGENT: ProviderOption = {
  value: "",
  label: "none",
  detail: "no custom subagent — Claude runs the turn itself",
};

/** The `agents` folder for one scope. The two are not siblings: the project
 * one is nested under `.claude`, the user one is already inside it. */
export function agentsDirFor(
  scope: SubagentScope,
  opts: { projectDir: string; configDir: string },
): string {
  return scope === "project"
    ? path.join(opts.projectDir, ".claude", "agents")
    : path.join(opts.configDir, "agents");
}

/**
 * Split a leading YAML frontmatter block from the markdown after it.
 *
 * Deliberately line-based rather than a YAML parse: the frontmatter this cares
 * about is a handful of flat string keys, and a dependency-free reader that
 * returns nothing on an odd file is better than one that throws on the
 * operator's hand-written markdown.
 *
 * A file with no opening `---` is all body. One with no *closing* `---` is all
 * frontmatter and no body — the same reading the parser has always taken.
 * Empty values are dropped, so an `tools:` with nothing after it reads as
 * absent, which is what it means to the CLI.
 */
export function splitFrontmatter(source: string): {
  keys: Map<string, string>;
  body: string;
} {
  const lines = source.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { keys: new Map(), body: source };

  const keys = new Map<string, string>();
  let close = lines.length;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "---") {
      close = i;
      break;
    }
    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (match === null) continue;
    const key = match[1] as string;
    const value = unquote(match[2] ?? "");
    // First occurrence wins, and an empty value is no value.
    if (value !== "" && !keys.has(key)) keys.set(key, value);
  }

  // One blank line after the closing marker is the conventional separator, not
  // part of the prompt; the newline every file ends with is a property of
  // files, not of what the operator wrote. Trimming both is what makes a body
  // survive a read/write round trip unchanged — without it every save would
  // hand the editor back a prompt that differs from the one it submitted.
  const rest = lines.slice(close + 1);
  if (rest[0] === "") rest.shift();
  return { keys, body: rest.join("\n").replace(/\s+$/, "") };
}

/**
 * Strip one layer of quoting; anything else is taken literally.
 *
 * A double-quoted value is also unescaped (`\"` and `\\`), which is what makes
 * the writer's output round-trip: it quotes with JSON when a value would
 * otherwise be ambiguous to YAML, and JSON's escaping of those two characters
 * is exactly YAML's.
 */
function unquote(raw: string): string {
  const trimmed = raw.trim();
  const double = /^"(.*)"$/s.exec(trimmed);
  if (double !== null) return (double[1] as string).replace(/\\([\\"])/g, "$1");
  const single = /^'(.*)'$/s.exec(trimmed);
  if (single !== null) return (single[1] as string).trim();
  return trimmed;
}

/**
 * Pull `name` and `description` out of the leading YAML frontmatter.
 *
 * Kept as its own export because it is the narrow question most callers have,
 * and because its contract predates the fuller read below.
 */
export function parseAgentFrontmatter(source: string): {
  name?: string;
  description?: string;
} {
  const { keys } = splitFrontmatter(source);
  const out: { name?: string; description?: string } = {};
  const name = keys.get("name");
  const description = keys.get("description");
  if (name !== undefined) out.name = name;
  if (description !== undefined) out.description = description;
  return out;
}

async function readSubagentsIn(
  dir: string,
  scope: SubagentScope,
): Promise<Subagent[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // No agents folder is the ordinary case, not a failure.
    return [];
  }

  const found: Subagent[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const file = path.join(dir, entry);
    let source: string;
    try {
      source = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const { keys, body } = splitFrontmatter(source);
    const stem = entry.slice(0, -3);
    // The CLI keys on the frontmatter name and falls back to the filename.
    const declared = keys.get("name");
    const name = declared ?? stem;
    if (name === "") continue;
    found.push({
      name,
      description: keys.get("description") ?? "",
      prompt: body,
      model: keys.get("model") ?? "",
      tools: keys.get("tools") ?? "",
      scope,
      file,
      ...(declared !== undefined && declared !== stem
        ? { renamedOnSave: true as const }
        : {}),
      ...(SUBAGENT_NAME_PATTERN.test(name) ? {} : { readOnly: true as const }),
    });
  }
  return found;
}

/**
 * Every subagent file the operator has, across both scopes.
 *
 * Unlike `readCustomAgents` this reports *both* sides of a name collision,
 * with the losing one marked `shadowed`. An operator whose edit had no effect
 * has to be able to see why, and that is not something a menu row can say.
 */
export async function readSubagents(opts: {
  projectDir: string;
  configDir: string;
}): Promise<Subagent[]> {
  const [user, project] = await Promise.all([
    readSubagentsIn(agentsDirFor("user", opts), "user"),
    readSubagentsIn(agentsDirFor("project", opts), "project"),
  ]);

  const projectNames = new Set(project.map((agent) => agent.name));
  const all = [
    ...project,
    ...user.map((agent) =>
      projectNames.has(agent.name) ? { ...agent, shadowed: true as const } : agent,
    ),
  ];

  return all.sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
    });
    if (byName !== 0) return byName;
    // The one that wins leads, so a collision reads top-down as "this one, and
    // this other one it is hiding".
    return a.scope === "project" ? -1 : 1;
  });
}

export async function readCustomAgents(opts: {
  projectDir: string;
  configDir: string;
}): Promise<ProviderOption[]> {
  const agents = (await readSubagents(opts))
    // A shadowed agent is not what would run, so it is not a row to pick.
    .filter((agent) => agent.shadowed === undefined)
    .map((agent) => ({
      value: agent.name,
      label: agent.name,
      ...(agent.description !== "" ? { detail: agent.description } : {}),
    }));

  // "none" always leads: it has to stay reachable after another is picked, and
  // an operator with no custom agents still sees a row that works.
  return [NO_AGENT, ...agents];
}
