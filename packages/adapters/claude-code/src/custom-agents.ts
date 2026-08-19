import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderOption } from "@overseer/protocol";

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
 */

/** The row entry for "no subagent" — the agent runs the turn itself. */
export const NO_AGENT: ProviderOption = {
  value: "",
  label: "none",
  detail: "no custom subagent — Claude runs the turn itself",
};

/**
 * Pull `name` and `description` out of the leading YAML frontmatter.
 *
 * Deliberately line-based rather than a YAML parse: the frontmatter this cares
 * about is two flat string keys, and a dependency-free reader that returns
 * nothing on an odd file is better than one that throws on the operator's
 * hand-written markdown.
 */
export function parseAgentFrontmatter(source: string): {
  name?: string;
  description?: string;
} {
  const lines = source.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};

  const out: { name?: string; description?: string } = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "---") break;
    const match = /^(name|description)\s*:\s*(.*)$/.exec(line);
    if (match === null) continue;
    const key = match[1] as "name" | "description";
    // Strip one layer of quoting; anything else is taken literally.
    const value = (match[2] ?? "")
      .trim()
      .replace(/^"(.*)"$/s, "$1")
      .replace(/^'(.*)'$/s, "$1")
      .trim();
    if (value !== "" && out[key] === undefined) out[key] = value;
  }
  return out;
}

async function readAgentsIn(dir: string): Promise<ProviderOption[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // No agents folder is the ordinary case, not a failure.
    return [];
  }

  const found: ProviderOption[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    let source: string;
    try {
      source = await readFile(path.join(dir, entry), "utf8");
    } catch {
      continue;
    }
    const { name, description } = parseAgentFrontmatter(source);
    // The CLI keys on the frontmatter name and falls back to the filename.
    const value = name ?? entry.slice(0, -3);
    if (value === "") continue;
    found.push({
      value,
      label: value,
      ...(description !== undefined ? { detail: description } : {}),
    });
  }
  return found;
}

export async function readCustomAgents(opts: {
  projectDir: string;
  configDir: string;
}): Promise<ProviderOption[]> {
  const [user, project] = await Promise.all([
    readAgentsIn(path.join(opts.configDir, "agents")),
    readAgentsIn(path.join(opts.projectDir, ".claude", "agents")),
  ]);

  // Project last so it overwrites a user-level agent of the same name.
  const byName = new Map<string, ProviderOption>();
  for (const agent of [...user, ...project]) byName.set(agent.value, agent);

  const agents = [...byName.values()].sort((a, b) =>
    a.value.localeCompare(b.value, undefined, { sensitivity: "base" }),
  );

  // "none" always leads: it has to stay reachable after another is picked, and
  // an operator with no custom agents still sees a row that works.
  return [NO_AGENT, ...agents];
}
