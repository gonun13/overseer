import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SUBAGENT_NAME_PATTERN,
  type Subagent,
  type SubagentDraft,
  type SubagentScope,
} from "@overseer/protocol";
import {
  KNOWN_KEYS,
  agentsDir,
  readSubagents,
  splitFrontmatter,
  subagentFrom,
} from "./custom-agents.js";

/**
 * Writing the operator's subagent files.
 *
 * The reader next door is deliberately forgiving — it has to survive whatever
 * an operator hand-wrote. The writer is the opposite: everything it emits must
 * come back out of that reader unchanged, and must also be a file the real CLI
 * agrees with.
 *
 * Cursor adds one obligation claude-code's writer does not have. Its agent
 * files carry keys this protocol has no field for — `permissionMode`,
 * `isBackground`, `forceDefaultModel` — and an operator who opens such a file
 * to fix a typo in the prompt must not have those silently deleted on save. So
 * the writer is not a pure function of the draft: it reads what is already on
 * disk and replays every key it does not itself understand.
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
 * a YAML double-quoted scalar uses, and it is what the reader's `unquote`
 * reverses.
 */
function emit(key: string, value: string): string {
  const flat = value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  return `${key}: ${needsQuoting(flat) ? JSON.stringify(flat) : flat}\n`;
}

/**
 * Render a draft as the file it becomes, carrying `extra` through.
 *
 * Blank `tools`/`model` are omitted rather than emitted empty: to the CLI an
 * absent `tools` means "inherit every tool", which is not what an empty
 * allowlist would mean. `extra` is whatever the previous file said that this
 * layer has no field for, in the order it said it. The body is written
 * verbatim — a `---` inside it is safe, because the reader stops at the first
 * closing marker.
 */
export function serializeAgentFile(
  draft: SubagentDraft,
  extra: Map<string, string> = new Map(),
): string {
  let out = "---\n";
  out += emit("name", draft.name);
  out += emit("description", draft.description);
  if (draft.tools.trim() !== "") out += emit("tools", draft.tools);
  if (draft.model.trim() !== "") out += emit("model", draft.model);
  for (const [key, value] of extra) {
    if (KNOWN_KEYS.has(key)) continue;
    out += emit(key, value);
  }
  out += "---\n\n";
  out += `${draft.prompt.replace(/\s+$/, "")}\n`;
  return out;
}

/**
 * Cursor resolves subagents only under the workspace — there is no user-scoped
 * agents folder to write into. Refused rather than quietly redirected: an
 * operator who asked for an agent that follows them between projects would
 * otherwise get one silently confined to this one.
 */
function requireProjectScope(scope: SubagentScope): void {
  if (scope !== "project") {
    throw new Error(
      "cursor keeps subagents in the project's .cursor/agents — it has no user-wide agents folder",
    );
  }
}

/**
 * Where an agent of this name actually lives.
 *
 * Composed from the name for the common case, but resolved through the real
 * listing when that misses — the file may carry a different extension, or a
 * frontmatter name that disagrees with its filename. Recomposing a path in
 * either case would unlink the wrong file, or nothing at all.
 */
async function locate(
  name: string,
  projectDir: string,
): Promise<string | undefined> {
  const composed = path.join(agentsDir(projectDir), `${name}.md`);
  if (SUBAGENT_NAME_PATTERN.test(name)) {
    try {
      await readFile(composed, "utf8");
      return composed;
    } catch {
      // Fall through to the listing.
    }
  }
  const found = (await readSubagents({ projectDir })).find(
    (agent) => agent.name === name,
  );
  return found?.file;
}

/** The keys of a file this layer does not understand, so they can be put back.
 * A file that is not there yet has none, which is the ordinary create case. */
async function carriedKeys(file: string | undefined): Promise<Map<string, string>> {
  if (file === undefined) return new Map();
  try {
    const { keys } = splitFrontmatter(await readFile(file, "utf8"));
    for (const key of KNOWN_KEYS) keys.delete(key);
    return keys;
  } catch {
    return new Map();
  }
}

export async function writeSubagentFile(opts: {
  projectDir: string;
  draft: SubagentDraft;
  previous?: { name: string; scope: SubagentScope };
}): Promise<Subagent> {
  const { draft, projectDir } = opts;
  requireProjectScope(draft.scope);
  // Re-validated here rather than trusted from the caller: this module is also
  // reached from tests, and one day from something that is not the server.
  if (!SUBAGENT_NAME_PATTERN.test(draft.name)) {
    throw new Error(
      `not a usable subagent name: ${draft.name} (lowercase letters, numbers and hyphens)`,
    );
  }

  const dir = agentsDir(projectDir);
  const target = path.join(dir, `${draft.name}.md`);

  const previousFile =
    opts.previous === undefined
      ? undefined
      : await locate(opts.previous.name, projectDir);

  if (target !== previousFile) {
    let taken = true;
    try {
      await readFile(target, "utf8");
    } catch {
      taken = false;
    }
    if (taken) throw new Error(`a subagent named ${draft.name} already exists`);
  }

  // Read the keys we are about to overwrite *before* overwriting them — from
  // the file being edited when this is a rename, from the target otherwise.
  const extra = await carriedKeys(previousFile ?? target);

  // `.cursor/agents` usually does not exist yet in a project.
  await mkdir(dir, { recursive: true });
  await writeFile(target, serializeAgentFile(draft, extra), "utf8");

  // Write, then unlink — never the reverse. A crash between the two leaves a
  // duplicate the operator can see and delete, not a hole where their prompt
  // used to be.
  if (previousFile !== undefined && previousFile !== target) {
    await rm(previousFile, { force: true });
  }

  // Read back rather than echo the draft: the file on disk is the answer, and
  // it is what the operator's next edit will start from.
  const written = subagentFrom(target, await readFile(target, "utf8"));
  if (written === undefined) throw new Error(`could not read back ${target}`);
  return written;
}

export async function deleteSubagentFile(opts: {
  projectDir: string;
  name: string;
  scope: SubagentScope;
}): Promise<void> {
  requireProjectScope(opts.scope);
  const file = await locate(opts.name, opts.projectDir);
  if (file === undefined) {
    throw new Error(`no subagent named ${opts.name}`);
  }
  await rm(file, { force: true });
  // The folder stays. An empty `.cursor/agents` is not litter, and the
  // operator may have created it deliberately.
}
