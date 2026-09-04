import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SUBAGENT_NAME_PATTERN,
  type Subagent,
  type SubagentDraft,
  type SubagentScope,
} from "@overseer/protocol";
import { agentsDirFor, readSubagents, splitFrontmatter } from "./custom-agents.js";

/**
 * Writing the operator's subagent files.
 *
 * The reader next door is deliberately forgiving — it has to survive whatever
 * an operator hand-wrote. The writer is the opposite: everything it emits must
 * come back out of that reader unchanged, and must also be a file the real CLI
 * agrees with. That round-trip is the whole contract of this module, and it is
 * what `subagent-files.test.ts` spends most of its cases on.
 */

/** YAML scalars that mean something other than themselves, plus the leading
 * characters that start a non-scalar node. A value matching any of these has
 * to be quoted or it changes meaning on the way back in. */
const YAML_RESERVED = new Set([
  "true",
  "false",
  "yes",
  "no",
  "on",
  "off",
  "null",
  "~",
]);
const YAML_INDICATORS = "#&*!|>%@`'\"[]{},";

function needsQuoting(value: string): boolean {
  if (value === "") return true;
  if (YAML_RESERVED.has(value.toLowerCase())) return true;
  if (YAML_INDICATORS.includes(value[0] as string)) return true;
  if (value.startsWith("- ") || value === "-") return true;
  // `: ` opens a mapping and ` #` opens a comment, anywhere in the line.
  if (value.includes(": ") || value.includes(" #")) return true;
  if (value.endsWith(":")) return true;
  return value.trim() !== value;
}

/**
 * One frontmatter line.
 *
 * Quoted only when the value would otherwise be ambiguous — these files are
 * hand-edited, and `name: reviewer` is what every existing one looks like.
 * `JSON.stringify` is the quoting: its escaping of `"` and `\` is exactly what
 * a YAML double-quoted scalar uses, and it is what `unquote` reverses.
 */
function emit(key: string, value: string): string {
  const flat = value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  return `${key}: ${needsQuoting(flat) ? JSON.stringify(flat) : flat}\n`;
}

/**
 * Render a draft as the file it becomes.
 *
 * Blank `tools`/`model` are omitted rather than emitted empty: to the CLI an
 * absent `tools` means "inherit every tool", which is not what an empty
 * allowlist would mean. The body is written verbatim — a `---` inside it is
 * safe, because the reader stops at the first closing marker.
 */
export function serializeAgentFile(draft: SubagentDraft): string {
  let out = "---\n";
  out += emit("name", draft.name);
  out += emit("description", draft.description);
  if (draft.tools.trim() !== "") out += emit("tools", draft.tools);
  if (draft.model.trim() !== "") out += emit("model", draft.model);
  out += "---\n\n";
  out += `${draft.prompt.replace(/\s+$/, "")}\n`;
  return out;
}

async function readOne(file: string, scope: SubagentScope): Promise<Subagent> {
  const source = await readFile(file, "utf8");
  const { keys, body } = splitFrontmatter(source);
  const stem = path.basename(file, ".md");
  const declared = keys.get("name");
  const name = declared ?? stem;
  return {
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
  };
}

/**
 * Where an agent of this name and scope actually lives.
 *
 * Composed from the name for the common case, but resolved through the real
 * listing when a file's frontmatter name disagrees with its filename — that
 * agent is reachable under a name no path can be built from, and recomposing
 * one would unlink the wrong file (or nothing at all).
 */
async function locate(
  name: string,
  scope: SubagentScope,
  dirs: { projectDir: string; configDir: string },
): Promise<string | undefined> {
  const composed = path.join(agentsDirFor(scope, dirs), `${name}.md`);
  if (SUBAGENT_NAME_PATTERN.test(name)) {
    try {
      await readFile(composed, "utf8");
      return composed;
    } catch {
      // Fall through: the name is well-formed but the file is not where it
      // would be if the frontmatter and the filename agreed.
    }
  }
  const found = (await readSubagents(dirs)).find(
    (agent) => agent.name === name && agent.scope === scope,
  );
  return found?.file;
}

export async function writeSubagentFile(opts: {
  projectDir: string;
  configDir: string;
  draft: SubagentDraft;
  previous?: { name: string; scope: SubagentScope };
}): Promise<Subagent> {
  const { draft } = opts;
  // Re-validated here rather than trusted from the caller: this module is also
  // reached from tests, and one day from something that is not the server.
  if (!SUBAGENT_NAME_PATTERN.test(draft.name)) {
    throw new Error(
      `not a usable subagent name: ${draft.name} (lowercase letters, numbers and hyphens)`,
    );
  }

  const dir = agentsDirFor(draft.scope, opts);
  const target = path.join(dir, `${draft.name}.md`);

  const previousFile =
    opts.previous === undefined
      ? undefined
      : await locate(opts.previous.name, opts.previous.scope, opts);

  if (target !== previousFile) {
    let taken = true;
    try {
      await readFile(target, "utf8");
    } catch {
      taken = false;
    }
    if (taken) throw new Error(`a ${draft.scope} subagent named ${draft.name} already exists`);
  }

  // `.claude/agents` usually does not exist yet in a project.
  await mkdir(dir, { recursive: true });
  await writeFile(target, serializeAgentFile(draft), "utf8");

  // Write, then unlink — never the reverse. A crash between the two leaves a
  // duplicate the operator can see and delete, not a hole where their prompt
  // used to be.
  if (previousFile !== undefined && previousFile !== target) {
    await rm(previousFile, { force: true });
  }

  // Read back rather than echo the draft: the file on disk is the answer, and
  // it is what the operator's next edit will start from.
  return readOne(target, draft.scope);
}

export async function deleteSubagentFile(opts: {
  projectDir: string;
  configDir: string;
  name: string;
  scope: SubagentScope;
}): Promise<void> {
  const file = await locate(opts.name, opts.scope, opts);
  if (file === undefined) {
    throw new Error(`no ${opts.scope} subagent named ${opts.name}`);
  }
  await rm(file, { force: true });
  // The folder stays. An empty `.claude/agents` is not litter, and the
  // operator may have created it deliberately.
}
