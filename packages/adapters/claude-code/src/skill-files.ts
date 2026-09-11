import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SKILL_NAME_PATTERN,
  type Skill,
  type SkillImportOutcome,
  type SkillScope,
  type SkillSkipped,
} from "@overseer/protocol";
import {
  readSkillDir,
  readSkillFile,
  readSkills,
  skillsDirFor,
  SKILL_FILE,
} from "./skills.js";

/**
 * Installing and removing the operator's skill folders.
 *
 * The reader next door is forgiving — it has to survive whatever an operator
 * imported. This half is the opposite: everything it installs must come back
 * out of that reader, and must be a folder the real CLI agrees is a skill.
 *
 * The directory shape drives the one real difference from `subagent-files.ts`.
 * A subagent write is a single `writeFile`, atomic enough that a crash leaves
 * either the old file or the new one. Copying a *tree* is not: a crash halfway
 * through leaves a folder holding some of a skill, and the CLI would load it.
 * So the copy lands in a sibling staging directory and is `rename`d into place
 * — one syscall, atomic on the same filesystem, and the partial state is never
 * reachable under the name the CLI scans for.
 */

/** Prefix for the sibling directory a copy lands in before its rename. Dotted
 * so a crashed import is skipped by the reader's own walk (which only descends
 * into entries it finds, and never into one holding no `SKILL.md`) and is
 * obvious to an operator who goes looking. */
const STAGING_PREFIX = ".importing-";

/** Enough to name the problem without walking a monorepo to its floor. */
const MAX_CANDIDATES = 50;

/**
 * Derive the name an imported skill lands under.
 *
 * Precedence: what the operator asked for, then what the skill calls itself in
 * its frontmatter, then the folder it arrived in. The first is a deliberate
 * override, the second is the skill's own claim, and the third is what the CLI
 * would key on anyway.
 */
export async function resolveSkillName(
  stagingDir: string,
  override?: string,
): Promise<string> {
  if (override !== undefined && override.trim() !== "") return override.trim();
  // Read it as a skill to reuse one parser rather than re-deriving frontmatter
  // handling here. Scope is irrelevant to the name, so any value does.
  const read = await readSkillDir(stagingDir, "project");
  return read?.name ?? path.basename(stagingDir);
}

/**
 * One importable thing found in a fetched source.
 *
 * Two shapes, because skills are published in two: a **folder** holding a
 * `SKILL.md` (what a CLI reads on disk) and a flat **file**, `<name>.md`
 * carrying the same frontmatter (what a collection repository usually holds).
 * Both install as a folder; only the reading differs.
 */
export type SkillSourceEntry =
  | { kind: "dir"; path: string; skill: Skill }
  | { kind: "file"; path: string; skill: Skill };

/**
 * Everything in a fetched source that is a skill.
 *
 * The search goes two directories deep, which is what the real shapes need: a
 * single-skill repository puts its `SKILL.md` at the root or one level down, a
 * collection puts folders or flat files under `skills/`.
 *
 * A skill folder is a leaf — nothing inside one is a second skill, so the walk
 * does not descend into it. That also keeps a skill's own `references/*.md`
 * from being mistaken for eight more skills.
 */
export async function findSkillSources(
  root: string,
): Promise<SkillSourceEntry[]> {
  // The root itself, when the operator pointed straight at one.
  const asDir = await readSkillDir(root, "project");
  if (asDir !== undefined) return [{ kind: "dir", path: root, skill: asDir }];

  const asFile = await readSkillFile(root, "project");
  if (asFile !== undefined) return [{ kind: "file", path: root, skill: asFile }];

  const found: SkillSourceEntry[] = [];

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth > 2 || found.length >= MAX_CANDIDATES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_CANDIDATES) return;
      // A dot entry is the clone's own machinery, never the skill meant.
      if (entry.name.startsWith(".")) continue;
      const child = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const skill = await readSkillDir(child, "project");
        if (skill !== undefined) {
          found.push({ kind: "dir", path: child, skill });
          continue; // a skill folder is a leaf
        }
        await scan(child, depth + 1);
        continue;
      }

      const skill = await readSkillFile(child, "project");
      if (skill !== undefined) found.push({ kind: "file", path: child, skill });
    }
  }

  await scan(root, 1);

  // Deterministic, so a bulk import reports in an order the operator can read.
  return found.sort((a, b) =>
    a.skill.name.localeCompare(b.skill.name, undefined, { sensitivity: "base" }),
  );
}

/**
 * Where a skill of this name and scope actually lives.
 *
 * Composed from the name for the common case, but resolved through the real
 * listing when a folder's frontmatter name disagrees with its directory — that
 * skill is reachable under a name no path can be built from, and recomposing
 * one would remove the wrong folder (or nothing at all). Exactly the argument
 * `locate` makes in `subagent-files.ts`.
 */
async function locate(
  name: string,
  scope: SkillScope,
  dirs: { projectDir: string; configDir: string },
): Promise<string | undefined> {
  const composed = path.join(skillsDirFor(scope, dirs), name);
  if (SKILL_NAME_PATTERN.test(name)) {
    if ((await readSkillDir(composed, scope)) !== undefined) return composed;
    // Fall through: the name is well-formed but the folder is not where it
    // would be if the frontmatter and the directory agreed.
  }
  const found = (await readSkills(dirs)).find(
    (skill) => skill.name === name && skill.scope === scope,
  );
  return found?.dir;
}

/**
 * Rewrite the `name:` a `SKILL.md` declares, so it agrees with the folder.
 *
 * Needed only when the operator renamed on import. Both CLIs key a skill on its
 * directory, so a folder called `renamed` holding a file that still says
 * `name: pdf-forms` is not merely untidy — it is the disagreement that makes
 * `renamedOnSave` a thing the subagent editor has to warn about. An importer
 * that can rename cheaply should not create it.
 *
 * Line-based, matching the reader next door: replace the key if it is there,
 * insert it after the opening marker if the block exists without one, and open
 * a block if there is no frontmatter at all.
 */
export function setFrontmatterName(source: string, name: string): string {
  const lines = source.split(/\r?\n/);

  if (lines[0]?.trim() !== "---") {
    return `---\nname: ${name}\n---\n\n${source.replace(/^\s+/, "")}`;
  }

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "---") {
      // Closed the block without finding a name — declare one at the top.
      lines.splice(1, 0, `name: ${name}`);
      return lines.join("\n");
    }
    if (/^name\s*:/.test(line)) {
      lines[i] = `name: ${name}`;
      return lines.join("\n");
    }
  }

  // An unterminated block is all frontmatter, per the reader's own reading.
  lines.splice(1, 0, `name: ${name}`);
  return lines.join("\n");
}

/**
 * Install one candidate, returning it as read back off disk.
 *
 * The copy lands in a sibling staging directory and is `rename`d into place —
 * one syscall, atomic on the same filesystem — so a crash never leaves a
 * partial folder under a name the CLI scans for.
 */
async function installOne(
  entry: SkillSourceEntry,
  name: string,
  scope: SkillScope,
  dirs: { projectDir: string; configDir: string },
): Promise<Skill> {
  const dir = skillsDirFor(scope, dirs);
  const target = path.join(dir, name);

  // `.claude/skills` usually does not exist yet in a project.
  await mkdir(dir, { recursive: true });

  const staging = path.join(dir, `${STAGING_PREFIX}${name}`);
  await rm(staging, { recursive: true, force: true });
  try {
    if (entry.kind === "dir") {
      await cp(entry.path, staging, {
        recursive: true,
        // Never follow a link out of the source: a skill that symlinked to
        // `/etc` would otherwise be copied verbatim into the operator's config.
        dereference: false,
        // A skill's own `.git` is the clone's machinery, not part of the skill.
        filter: (source) => path.basename(source) !== ".git",
      });
    } else {
      // A flat `<name>.md` becomes the folder the CLI expects, with the file
      // as its `SKILL.md`. This is the whole of "a skill need not be a
      // directory to begin with".
      await mkdir(staging, { recursive: true });
      await writeFile(
        path.join(staging, SKILL_FILE),
        await readFile(entry.path, "utf8"),
        "utf8",
      );
    }

    // The folder is what both CLIs key on, so the installed name has to reach
    // the declaration too — otherwise the skill answers to one name and
    // describes itself with another.
    //
    // Unconditional, not "only when they differ". A source that declared no
    // name at all took its name from its filename, and wrapping it into a
    // folder would otherwise leave a SKILL.md that names nothing. Rewriting a
    // name to itself costs a write on a file already being copied, and buys
    // the invariant outright.
    const file = path.join(staging, SKILL_FILE);
    await writeFile(
      file,
      setFrontmatterName(await readFile(file, "utf8"), name),
      "utf8",
    );

    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }

  // Read back rather than echo what was copied: the folder on disk is the
  // answer, and it is what the operator's next look at the list will show.
  const installed = await readSkillDir(target, scope);
  if (installed === undefined) {
    throw new Error(`${name} did not install as a readable skill`);
  }
  return installed;
}

export async function importSkillDir(opts: {
  projectDir: string;
  configDir: string;
  stagingDir: string;
  scope: SkillScope;
  name?: string;
}): Promise<SkillImportOutcome> {
  const entries = await findSkillSources(opts.stagingDir);
  if (entries.length === 0) {
    throw new Error(
      `no skill found in that source — a skill is a folder with a ${SKILL_FILE}, or a markdown file with a description in its frontmatter`,
    );
  }

  const override = opts.name?.trim();
  if (override !== undefined && override !== "" && entries.length > 1) {
    // A single name cannot stand for several skills, and quietly applying it
    // to one of them would be a guess.
    throw new Error(
      `that source holds ${entries.length} skills — a name can only be given to one`,
    );
  }

  const imported: Skill[] = [];
  const skipped: SkillSkipped[] = [];

  for (const entry of entries) {
    const fallback =
      entry.kind === "file"
        ? path.basename(entry.path)
        : path.basename(entry.path);
    const name =
      override !== undefined && override !== "" ? override : entry.skill.name;

    // Re-validated per candidate rather than trusted: these names come from a
    // git URL or a frontmatter line, neither of which this layer saw composed.
    if (!SKILL_NAME_PATTERN.test(name)) {
      skipped.push({
        name: name || fallback,
        reason: "the name is not lowercase letters, numbers and hyphens",
      });
      continue;
    }
    if (entry.skill.description.trim() === "") {
      skipped.push({
        name,
        reason: "no description — that is what a task gets matched against",
      });
      continue;
    }
    if ((await locate(name, opts.scope, opts)) !== undefined) {
      // Ordinary rather than exceptional: re-importing a collection that
      // gained one skill skips the rest as already present.
      skipped.push({ name, reason: "already installed" });
      continue;
    }

    try {
      imported.push(await installOne(entry, name, opts.scope, opts));
    } catch (error) {
      skipped.push({
        name,
        reason: error instanceof Error ? error.message : "could not be installed",
      });
    }
  }

  // Nothing installed and nothing to say about it is the one case worth
  // throwing on — the caller has no outcome to report.
  if (imported.length === 0 && skipped.length === 0) {
    throw new Error(`no skill found in that source`);
  }

  return { imported, skipped };
}

export async function deleteSkillDir(opts: {
  projectDir: string;
  configDir: string;
  name: string;
  scope: SkillScope;
}): Promise<void> {
  const dir = await locate(opts.name, opts.scope, opts);
  if (dir === undefined) {
    throw new Error(`no ${opts.scope} skill named ${opts.name}`);
  }
  await rm(dir, { recursive: true, force: true });
  // The `skills` folder stays. An empty one is not litter, and the operator may
  // have created it deliberately.
}
