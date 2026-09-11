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
 * Installing and removing cursor's own skill folders.
 *
 * Writes land in `.cursor/skills` and nowhere else. The reader deliberately
 * surfaces skills it finds under `.claude`, `.codex`, `.grok` and `.agents`
 * because the CLI acts on them, but those belong to another provider's
 * directory: importing into one would mean a change aimed at cursor silently
 * altered what another provider runs, and deleting from one would remove a
 * skill that provider's own tab still lists. Both are refused here.
 *
 * The copy-then-rename is the same argument the claude-code adapter makes: a
 * skill is a tree, `cp -r` is not atomic, and a crash halfway through must not
 * leave a partial folder under a name the CLI scans for.
 */

const STAGING_PREFIX = ".importing-";

/** Enough to name the problem without walking a monorepo to its floor. */
const MAX_CANDIDATES = 50;

/** Precedence: the operator's override, the skill's own frontmatter, then the
 * folder it arrived in — which is what the CLI keys on anyway. */
export async function resolveSkillName(
  stagingDir: string,
  override?: string,
): Promise<string> {
  if (override !== undefined && override.trim() !== "") return override.trim();
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
 * Where a skill of this name and scope lives, in cursor's *own* directory.
 *
 * Resolved through the real listing when the composed path misses, so a folder
 * whose frontmatter name disagrees with its directory is still reachable. A
 * match in another provider's directory is not returned: this function exists
 * to find something to overwrite or unlink, and those are not ours to touch.
 */
async function locateOwn(
  name: string,
  scope: SkillScope,
  projectDir: string,
): Promise<string | undefined> {
  const composed = path.join(skillsDirFor(scope, projectDir), name);
  if (SKILL_NAME_PATTERN.test(name)) {
    if ((await readSkillDir(composed, scope)) !== undefined) return composed;
  }
  const found = (await readSkills({ projectDir })).find(
    (skill) =>
      skill.name === name && skill.scope === scope && skill.foreign === undefined,
  );
  return found?.dir;
}

/**
 * Rewrite the `name:` a `SKILL.md` declares, so it agrees with the folder.
 *
 * Cursor keys a skill on its directory name (verified in the shipped bundle,
 * which records `{ id, name: entry.name, path, scope }` as it walks), so a
 * folder renamed on import must carry the rename into the file too — otherwise
 * the skill answers to one name and describes itself with another.
 *
 * Line-based, matching the reader.
 */
export function setFrontmatterName(source: string, name: string): string {
  const lines = source.split(/\r?\n/);

  if (lines[0]?.trim() !== "---") {
    return `---\nname: ${name}\n---\n\n${source.replace(/^\s+/, "")}`;
  }

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "---") {
      lines.splice(1, 0, `name: ${name}`);
      return lines.join("\n");
    }
    if (/^name\s*:/.test(line)) {
      lines[i] = `name: ${name}`;
      return lines.join("\n");
    }
  }

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
  dirs: { projectDir: string },
): Promise<Skill> {
  const dir = skillsDirFor(scope, dirs.projectDir);
  const target = path.join(dir, name);

  // `.cursor/skills` usually does not exist yet in a project.
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
    if ((await locateOwn(name, opts.scope, opts.projectDir)) !== undefined) {
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
  name: string;
  scope: SkillScope;
}): Promise<void> {
  const dir = await locateOwn(opts.name, opts.scope, opts.projectDir);
  if (dir === undefined) {
    // Deliberately the same message whether the skill is absent or lives in
    // another provider's folder: the operator's next move is the same either
    // way, and the row itself already says where a foreign skill came from.
    throw new Error(`no ${opts.scope} skill named ${opts.name} in ${OWN_DIR_LABEL}`);
  }
  await rm(dir, { recursive: true, force: true });
  // The `skills` folder stays — an empty one is not litter.
}

const OWN_DIR_LABEL = ".cursor/skills";
