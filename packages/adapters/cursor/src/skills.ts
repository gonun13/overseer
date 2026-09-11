import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { SKILL_NAME_PATTERN, type Skill, type SkillScope } from "@overseer/protocol";
import { splitFrontmatter } from "./custom-agents.js";
import { cursorHome } from "./transcripts.js";

/**
 * The operator's own skills, as cursor's CLI resolves them.
 *
 * Two things differ from the subagent reader next door, and both are the CLI's
 * doing rather than this layer's choice:
 *
 * - **Two scopes, not one.** Cursor resolves agents only under the workspace,
 *   but it resolves *skills* under both the workspace and the operator's home.
 *   So unlike subagents, a cursor skill can be `scope: "user"`, and collisions
 *   have a precedence to encode.
 * - **Five config directories, not one.** Cursor reads other providers' skills
 *   as well as its own.
 *
 * Verified in the shipped bundle (`agent 2026.09.10-fd3934a`), which builds its
 * discovery roots by joining each entry of a config-dir table against the
 * workspace (for `scope: "project"`) and against `homedir()` (for
 * `scope: "user"`):
 *
 *   [ { configDir: ".cursor", subdir: "skills" },
 *     { configDir: ".claude", subdir: "skills", thirdParty: true },
 *     { configDir: ".codex",  subdir: "skills", thirdParty: true },
 *     { configDir: ".grok",   subdir: "skills", thirdParty: true },
 *     { configDir: ".agents", subdir: "skills" } ]
 *
 * A skill is one directory holding a `SKILL.md`, and the CLI keys it on the
 * directory name.
 *
 * The four directories that are not `.cursor` are listed but never written to,
 * and rows found in them carry `foreign`. Both halves of that matter. Hiding
 * them would make this inventory a description of one folder rather than of
 * what the session will actually do — an operator would watch cursor act on a
 * skill its own tab never showed. Writing to them would mean an import aimed at
 * cursor silently changed what claude-code runs, and a delete aimed at cursor
 * silently removed it from claude-code too.
 *
 * Never throws: a missing folder is the ordinary case, and an unreadable one
 * reports no skills rather than failing the row.
 */

/** The file that makes a directory a skill. */
export const SKILL_FILE = "SKILL.md";

/** Cursor's own config directory — the only one this adapter writes to. */
export const OWN_CONFIG_DIR = ".cursor";

/** Every config directory cursor's own discovery walks, its own leading. */
export const SKILL_CONFIG_DIRS = [
  OWN_CONFIG_DIR,
  ".claude",
  ".codex",
  ".grok",
  ".agents",
];

/** The root a scope resolves against: the workspace, or the operator's home. */
function scopeRoot(scope: SkillScope, projectDir: string): string {
  return scope === "project" ? projectDir : cursorHome();
}

/** The `skills` folder for one scope in one config directory. */
export function skillsDirFor(
  scope: SkillScope,
  projectDir: string,
  configDir: string = OWN_CONFIG_DIR,
): string {
  return path.join(scopeRoot(scope, projectDir), configDir, "skills");
}

const MAX_DEPTH = 4;
const MAX_ENTRIES = 200;

/** Everything besides `SKILL.md`, relative to the skill's folder, sorted.
 * Bounded because this is a count for a list row, not an inventory. */
async function listSupportingFiles(dir: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || found.length >= MAX_ENTRIES) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_ENTRIES) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      const relative = path.relative(dir, full);
      if (relative === SKILL_FILE) continue;
      found.push(relative);
    }
  }

  await walk(dir, 0);
  return found.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/**
 * Whether a markdown file is a skill in its own right.
 *
 * Published skills are often a flat `<name>.md` rather than a folder; the
 * artifact is the same and only the layout differs. The frontmatter is what
 * decides, specifically a **description** — that is what a task gets matched
 * against, and a markdown file without one is a document.
 *
 * `_`-prefixed files are passed over: that is the convention for a template or
 * partial, and `_template.md` carries a well-formed placeholder description
 * that nothing else would distinguish from a real skill.
 */
export function isSkillFileName(entry: string): boolean {
  if (!entry.endsWith(".md") && !entry.endsWith(".markdown")) return false;
  if (entry.startsWith(".") || entry.startsWith("_")) return false;
  return true;
}

/**
 * Read a flat `<name>.md` as a skill, or undefined when it is not one.
 *
 * Only ever used to identify an import *source*; an installed skill is always
 * a folder.
 */
export async function readSkillFile(
  file: string,
  scope: SkillScope,
): Promise<Skill | undefined> {
  if (!isSkillFileName(path.basename(file))) return undefined;

  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch {
    return undefined;
  }

  const { keys } = splitFrontmatter(source);
  const description = keys.get("description") ?? "";
  if (description.trim() === "") return undefined;

  const stem = path.basename(file).replace(/\.(md|markdown)$/, "");
  const name = keys.get("name") ?? stem;
  if (name === "") return undefined;

  return {
    name,
    description,
    scope,
    dir: path.dirname(file),
    file,
    files: [],
    ...(SKILL_NAME_PATTERN.test(name) ? {} : { readOnly: true as const }),
  };
}

/** Read one skill folder, or undefined when it is not one. */
export async function readSkillDir(
  dir: string,
  scope: SkillScope,
  foreign?: string,
): Promise<Skill | undefined> {
  const file = path.join(dir, SKILL_FILE);
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch {
    return undefined;
  }

  const { keys } = splitFrontmatter(source);
  const stem = path.basename(dir);
  const name = keys.get("name") ?? stem;
  if (name === "") return undefined;

  return {
    name,
    description: keys.get("description") ?? "",
    scope,
    dir,
    file,
    files: await listSupportingFiles(dir),
    ...(foreign !== undefined ? { foreign } : {}),
    ...(SKILL_NAME_PATTERN.test(name) ? {} : { readOnly: true as const }),
  };
}

/** Every skill directly inside one `skills` folder. */
export async function readSkillsIn(
  dir: string,
  scope: SkillScope,
  foreign?: string,
): Promise<Skill[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: Skill[] = [];
  for (const entry of entries) {
    let isDir = entry.isDirectory();
    if (!isDir && entry.isSymbolicLink()) {
      try {
        isDir = (await stat(path.join(dir, entry.name))).isDirectory();
      } catch {
        continue;
      }
    }
    if (!isDir) continue;
    const skill = await readSkillDir(path.join(dir, entry.name), scope, foreign);
    if (skill !== undefined) found.push(skill);
  }
  return found;
}

/**
 * Every skill cursor would resolve for one project, across both scopes and all
 * five config directories.
 *
 * Precedence: project beats user on a name collision, and within a scope the
 * config directories are tried in the CLI's own order, cursor's own first. A
 * row that loses is listed and marked `shadowed` rather than dropped — an
 * operator whose import had no effect needs to see the one hiding it.
 */
export async function readSkills(opts: { projectDir: string }): Promise<Skill[]> {
  const scopes: SkillScope[] = ["project", "user"];
  const reads: Promise<Skill[]>[] = [];
  for (const scope of scopes) {
    for (const configDir of SKILL_CONFIG_DIRS) {
      reads.push(
        readSkillsIn(
          skillsDirFor(scope, opts.projectDir, configDir),
          scope,
          configDir === OWN_CONFIG_DIR
            ? undefined
            : path.join(configDir, "skills"),
        ),
      );
    }
  }

  // Flattened in the order the loops queued them, which is the CLI's own
  // precedence order: every project row before every user row, and within each
  // scope, `.cursor` before the rest.
  const all = (await Promise.all(reads)).flat();

  const seen = new Set<string>();
  const ranked = all.map((skill) => {
    const hidden = seen.has(skill.name);
    seen.add(skill.name);
    return hidden ? { ...skill, shadowed: true as const } : skill;
  });

  return ranked.sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
    });
    if (byName !== 0) return byName;
    // The winner leads, so a collision reads top-down as "this one, and the
    // ones it is hiding".
    if (a.shadowed !== b.shadowed) return a.shadowed === true ? 1 : -1;
    return a.scope === "project" ? -1 : 1;
  });
}
