import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { SUBAGENT_NAME_PATTERN, type Subagent } from "@overseer/protocol";

/**
 * The operator's own subagents — the `.md` files they wrote, read straight off
 * disk.
 *
 * Cursor's CLI discovers these itself (verified in the shipped bundle, `agent
 * 2026.09.02-c22c1a3`: `computeAgentsDirs()` resolves
 * `join(workspacePath, ".cursor", "agents")` and globs
 * `**\/.cursor/agents/**\/*.{md,mdc,markdown}`), so this reads exactly what the
 * CLI will act on and nothing else.
 *
 * Two things differ from claude-code's reader next door, both because the CLI
 * does:
 *
 * - **One folder, not two.** Cursor resolves agents only under the workspace.
 *   There is no user-scoped agents directory, so every subagent here is
 *   `scope: "project"`, nothing is ever `shadowed`, and there is no precedence
 *   rule to encode.
 * - **Three extensions, not one.** `.mdc` and `.markdown` are as real to the
 *   CLI as `.md`, so the filename stem is derived from whichever extension
 *   matched — recomposing it as `name + ".md"` would mark every `.mdc` file
 *   `renamedOnSave` and then rename files the operator never asked to rename.
 *
 * Never throws: a missing folder is the ordinary case (most projects have no
 * agents), and an unreadable one reports no agents rather than failing the row.
 */

/** Every extension the CLI's own discovery globs accept. `.md` leads because
 * it is what this adapter writes. */
export const AGENT_EXTENSIONS = [".md", ".mdc", ".markdown"];

/** Keys this layer understands. Anything else in a file's frontmatter is the
 * CLI's business (`permissionMode`, `isBackground`, `forceDefaultModel`) and
 * has to survive a round trip through the editor untouched. */
export const KNOWN_KEYS = new Set(["name", "description", "tools", "model"]);

/** The one folder cursor reads agents from. */
export function agentsDir(projectDir: string): string {
  return path.join(projectDir, ".cursor", "agents");
}

/** The extension this file carries, or undefined if it is not an agent file. */
export function agentExtension(entry: string): string | undefined {
  return AGENT_EXTENSIONS.find((ext) => entry.endsWith(ext));
}

/**
 * Split a leading YAML frontmatter block from the markdown after it.
 *
 * Deliberately line-based rather than a YAML parse: the frontmatter this cares
 * about is a handful of flat string keys, and a dependency-free reader that
 * returns nothing on an odd file is better than one that throws on the
 * operator's hand-written markdown.
 *
 * The returned map keeps *every* key it matched, not just the understood ones,
 * and in file order — that is what lets the writer put an unrecognised key back
 * where it found it instead of dropping the operator's data.
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
  // survive a read/write round trip unchanged.
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

/** One agent file, read. Shared with the writer so a saved file and a listed
 * one can never disagree about what the file says. */
export function subagentFrom(file: string, source: string): Subagent | undefined {
  const entry = path.basename(file);
  const ext = agentExtension(entry);
  if (ext === undefined) return undefined;

  const { keys, body } = splitFrontmatter(source);
  const stem = entry.slice(0, -ext.length);
  // The CLI keys on the frontmatter name and falls back to the filename.
  const declared = keys.get("name");
  const name = declared ?? stem;
  if (name === "") return undefined;

  return {
    name,
    description: keys.get("description") ?? "",
    prompt: body,
    // The CLI defaults an absent model to "inherit"; "" is this protocol's
    // word for the same thing, so an absent key stays absent rather than
    // gaining a value the operator never wrote.
    model: keys.get("model") ?? "",
    tools: keys.get("tools") ?? "",
    scope: "project",
    file,
    ...(declared !== undefined && declared !== stem
      ? { renamedOnSave: true as const }
      : {}),
    ...(SUBAGENT_NAME_PATTERN.test(name) ? {} : { readOnly: true as const }),
  };
}

/** Every subagent file this project has. */
export async function readSubagents(opts: {
  projectDir: string;
}): Promise<Subagent[]> {
  const dir = agentsDir(opts.projectDir);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // No agents folder is the ordinary case, not a failure.
    return [];
  }

  const found: Subagent[] = [];
  for (const entry of entries) {
    if (agentExtension(entry) === undefined) continue;
    const file = path.join(dir, entry);
    let source: string;
    try {
      source = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const agent = subagentFrom(file, source);
    if (agent !== undefined) found.push(agent);
  }

  return found.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
