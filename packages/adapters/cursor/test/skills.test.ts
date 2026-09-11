import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { readSkills, skillsDirFor } from "../src/skills.js";
import { deleteSkillDir, importSkillDir } from "../src/skill-files.js";

/**
 * Cursor's skills, which differ from its subagents in the two ways its CLI
 * does: two scopes rather than one, and five config directories rather than
 * one. Both are asserted here because both are easy to regress into the
 * subagent shape.
 */

const HOME = process.env.HOME;
afterEach(() => {
  if (HOME === undefined) delete process.env.HOME;
  else process.env.HOME = HOME;
});

/** A scratch project plus a fake home, since cursor resolves user scope off
 * `$HOME` rather than a config-dir env var. */
async function scratch(): Promise<{ projectDir: string; home: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "overseer-cursor-skills-"));
  const home = path.join(root, "home");
  await mkdir(home, { recursive: true });
  process.env.HOME = home;
  return { projectDir: path.join(root, "project"), home };
}

async function source(root: string, name = "pdf-forms"): Promise<string> {
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, "SKILL.md"),
    `---\nname: ${name}\ndescription: Fills in PDF forms\n---\n\nDo the thing.\n`,
    "utf8",
  );
  return root;
}

/** Plant a skill directly in a config directory, as another provider's
 * importer would have left it. */
async function plant(
  root: string,
  configDir: string,
  name: string,
): Promise<void> {
  await source(path.join(root, configDir, "skills", name), name);
}

describe("cursor skills", () => {
  it("installs into its own .cursor/skills, in either scope", async () => {
    const dirs = await scratch();
    const staging = await source(path.join(dirs.projectDir, "..", "staging"));

    const project = (await importSkillDir({
      projectDir: dirs.projectDir,
      stagingDir: staging,
      scope: "project",
    })).imported[0]!;
    assert.equal(
      project.dir,
      path.join(dirs.projectDir, ".cursor", "skills", "pdf-forms"),
    );

    const user = (await importSkillDir({
      projectDir: dirs.projectDir,
      stagingDir: staging,
      scope: "user",
    })).imported[0]!;
    // User scope resolves off the home directory, not the project — the thing
    // cursor's subagents deliberately do not have.
    assert.equal(user.dir, path.join(dirs.home, ".cursor", "skills", "pdf-forms"));
  });

  it("offers a user scope at all, unlike its subagents", async () => {
    const dirs = await scratch();
    assert.equal(
      skillsDirFor("user", dirs.projectDir),
      path.join(dirs.home, ".cursor", "skills"),
    );
  });

  it("lists a skill the CLI reads from another provider's folder, marked foreign", async () => {
    const dirs = await scratch();
    await plant(dirs.projectDir, ".claude", "from-claude");

    const all = await readSkills({ projectDir: dirs.projectDir });

    assert.equal(all.length, 1);
    assert.equal(all[0]?.name, "from-claude");
    // Listed because the session will act on it; marked because cursor does
    // not own it.
    assert.equal(all[0]?.foreign, ".claude/skills");
  });

  it("does not mark its own skills foreign", async () => {
    const dirs = await scratch();
    await plant(dirs.projectDir, ".cursor", "mine");

    const all = await readSkills({ projectDir: dirs.projectDir });
    assert.equal(all[0]?.foreign, undefined);
  });

  it("refuses to delete a skill that belongs to another provider's folder", async () => {
    const dirs = await scratch();
    await plant(dirs.projectDir, ".claude", "from-claude");

    // Removing it here would take it out from under claude-code too.
    await assert.rejects(
      deleteSkillDir({
        projectDir: dirs.projectDir,
        name: "from-claude",
        scope: "project",
      }),
      /no project skill named from-claude/,
    );

    const all = await readSkills({ projectDir: dirs.projectDir });
    assert.equal(all.length, 1);
  });

  it("prefers its own folder over a foreign one on a name collision", async () => {
    const dirs = await scratch();
    await plant(dirs.projectDir, ".cursor", "shared");
    await plant(dirs.projectDir, ".claude", "shared");

    const all = await readSkills({ projectDir: dirs.projectDir });

    assert.equal(all.length, 2);
    // Cursor's own leads, and the one it hides says so.
    assert.equal(all[0]?.foreign, undefined);
    assert.equal(all[0]?.shadowed, undefined);
    assert.equal(all[1]?.foreign, ".claude/skills");
    assert.equal(all[1]?.shadowed, true);
  });

  it("prefers a project skill over a user one of the same name", async () => {
    const dirs = await scratch();
    await plant(dirs.projectDir, ".cursor", "shared");
    await plant(dirs.home, ".cursor", "shared");

    const all = await readSkills({ projectDir: dirs.projectDir });

    assert.equal(all.length, 2);
    assert.equal(all[0]?.scope, "project");
    assert.equal(all[0]?.shadowed, undefined);
    assert.equal(all[1]?.scope, "user");
    assert.equal(all[1]?.shadowed, true);
  });
});
