import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { SKILL_NAME_PATTERN, type Skill, type SkillScope } from "@overseer/protocol";
import { splitFrontmatter } from "./custom-agents.js";

/**
 * The operator's own skills — the folders they imported into a `skills`
 * directory.
 *
 * Two directories, exactly as with subagents:
 *
 *   <project>/.claude/skills/<name>/SKILL.md   — this project
 *   $CLAUDE_CONFIG_DIR/skills/<name>/SKILL.md  — every project
 *
 * Project wins on a name collision, which is the CLI's own precedence.
 *
 * **Verified against `claude 2.1.226` in the container**, not read off a doc
 * page: a probe skill planted in each directory resolved when invoked as
 * `/<name>`. The same probe returned `Unknown command` under
 * `--setting-sources ""`, which is why the loop bundle
 * (`providers/claude-code/provider.sh`) does not see skills and is deliberately
 * left out — widening that flag would re-admit the operator's `settings.json`,
 * which the bundle overrides on purpose. App sessions need nothing: they spawn
 * with `cwd: projectDir` and an explicit `CLAUDE_CONFIG_DIR`, so both
 * directories are already on the CLI's own discovery path.
 *
 * A skill is a *directory*, which is the one structural difference from the
 * subagent reader next door. The name comes from the folder, not the file, and
 * the body is never read: nothing in this app edits a skill's prose, so paying
 * to read every `SKILL.md` in full would buy a field no window displays. What
 * is read is the frontmatter, for the description, and the folder listing, for
 * the file count.
 *
 * Never throws: a missing folder is the ordinary case (most operators have
 * none), and an unreadable one reports no skills rather than failing the row.
 */

/** The `skills` folder for one scope. As with `agentsDirFor`, the two are not
 * siblings: the project one is nested under `.claude`, the user one is already
 * inside it. */
export function skillsDirFor(
  scope: SkillScope,
  opts: { projectDir: string; configDir: string },
): string {
  return scope === "project"
    ? path.join(opts.projectDir, ".claude", "skills")
    : path.join(opts.configDir, "skills");
}

/** The file that makes a directory a skill. Both CLIs agree on the name. */
export const SKILL_FILE = "SKILL.md";

/**
 * Everything in the skill's folder besides `SKILL.md`, relative to it, sorted.
 *
 * Walks nested directories because skills routinely carry a `references/` or
 * `scripts/` folder, but stops at `MAX_DEPTH` and `MAX_ENTRIES`: this is a
 * count for a list row, and an operator who imported something pathological
 * should get a truncated list rather than a hung window.
 */
const MAX_DEPTH = 4;
const MAX_ENTRIES = 200;

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
 * A published skill is often a single `<name>.md` rather than a folder — the
 * `skills/` directory of a collection repository is typically flat. The file is
 * the same artifact; only the layout differs. What makes it a skill is the
 * frontmatter, specifically a **description**: that is what a CLI matches a
 * task against, and a markdown file without one is a document, not a skill.
 * (`name` is not required — the filename stands in, as it does for a folder.)
 *
 * Files whose name begins with `_` are passed over. That prefix is the
 * convention for a template or a partial — `_template.md` sits in exactly the
 * collections this reads, carries a perfectly well-formed placeholder
 * description, and is the one file in the folder nobody means to install.
 * Nothing else distinguishes it, so the convention is what gets honoured.
 */
export function isSkillFileName(entry: string): boolean {
  if (!entry.endsWith(".md") && !entry.endsWith(".markdown")) return false;
  if (entry.startsWith(".") || entry.startsWith("_")) return false;
  return true;
}

/**
 * Read a flat `<name>.md` as a skill, or undefined when it is not one.
 *
 * Returns the same shape a folder does, with `dir` naming the file's parent —
 * this is only ever used to *identify* an import source, never to describe an
 * installed skill, which is always a folder.
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
  // The description is the whole test. Without it the CLI could never route a
  // task here, so there is nothing to install.
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
    // A directory with no SKILL.md is not a skill. Neither CLI would load it,
    // so neither does this.
    return undefined;
  }

  const { keys } = splitFrontmatter(source);
  const stem = path.basename(dir);
  // The CLI keys on the directory name; the frontmatter name is what the skill
  // calls itself. Prefer the declaration and fall back to the folder, the same
  // precedence the subagent reader takes.
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
    // No skills folder is the ordinary case, not a failure.
    return [];
  }

  const found: Skill[] = [];
  for (const entry of entries) {
    // `withFileTypes` reports a symlink as neither file nor directory, so a
    // symlinked skill folder needs the explicit stat the CLI's own walk does.
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
 * Sort by name, then project-first on a collision.
 *
 * Shared with the cursor adapter's reader through neither module — each keeps
 * its own copy of its own CLI's precedence, and they happen to agree. A shared
 * helper here would be a claim that they must, which is not something this
 * layer gets to decide.
 */
export function sortSkills(skills: Skill[]): Skill[] {
  return skills.sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
    });
    if (byName !== 0) return byName;
    // The one that wins leads, so a collision reads top-down as "this one, and
    // this other one it is hiding".
    return a.scope === "project" ? -1 : 1;
  });
}

/**
 * Every skill the operator has, across both scopes, with the losing side of a
 * name collision marked `shadowed`.
 */
export async function readSkills(opts: {
  projectDir: string;
  configDir: string;
}): Promise<Skill[]> {
  const [user, project] = await Promise.all([
    readSkillsIn(skillsDirFor("user", opts), "user"),
    readSkillsIn(skillsDirFor("project", opts), "project"),
  ]);

  const projectNames = new Set(project.map((skill) => skill.name));
  return sortSkills([
    ...project,
    ...user.map((skill) =>
      projectNames.has(skill.name) ? { ...skill, shadowed: true as const } : skill,
    ),
  ]);
}
