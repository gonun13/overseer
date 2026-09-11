import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { readSkills, skillsDirFor } from "../src/skills.js";
import {
  deleteSkillDir,
  findSkillSources,
  importSkillDir,
  resolveSkillName,
} from "../src/skill-files.js";

/** A flat `<name>.md` skill, the shape published collections actually use. */
async function flat(
  file: string,
  opts: { name?: string; description?: string } = {},
): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  const front = [
    "---",
    ...(opts.name === "" ? [] : [`name: ${opts.name ?? "diagnose"}`]),
    ...(opts.description === "" ? [] : [`description: ${opts.description ?? "Works a bug through a gated loop."}`]),
    "---",
    "",
    "# Diagnose",
    "",
  ].join("\n");
  await writeFile(file, front, "utf8");
  return file;
}

async function scratch(): Promise<{ projectDir: string; configDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "overseer-skills-"));
  return {
    projectDir: path.join(root, "project"),
    configDir: path.join(root, "config"),
  };
}

/** Build a source folder the importer can read, as a fetch would have left it. */
async function source(
  root: string,
  opts: {
    name?: string;
    description?: string;
    extra?: Record<string, string>;
  } = {},
): Promise<string> {
  await mkdir(root, { recursive: true });
  const front = [
    "---",
    `name: ${opts.name ?? "pdf-forms"}`,
    ...(opts.description === undefined
      ? ["description: Fills in PDF forms"]
      : opts.description === ""
        ? []
        : [`description: ${opts.description}`]),
    "---",
    "",
    "Do the thing.",
    "",
  ].join("\n");
  await writeFile(path.join(root, "SKILL.md"), front, "utf8");
  for (const [rel, text] of Object.entries(opts.extra ?? {})) {
    const full = path.join(root, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, text, "utf8");
  }
  return root;
}

describe("importSkillDir", () => {
  it("installs a skill into the project scope and reads it back off disk", async () => {
    const dirs = await scratch();
    const staging = await source(path.join(dirs.projectDir, "..", "staging"));

    const { imported } = await importSkillDir({
      ...dirs,
      stagingDir: staging,
      scope: "project",
    });
    const skill = imported[0]!;

    assert.equal(skill.name, "pdf-forms");
    assert.equal(skill.description, "Fills in PDF forms");
    assert.equal(skill.scope, "project");
    assert.equal(
      skill.dir,
      path.join(skillsDirFor("project", dirs), "pdf-forms"),
    );
    // Read back, not echoed: the SKILL.md is really there.
    assert.match(await readFile(skill.file, "utf8"), /Do the thing/);
  });

  it("installs into the user scope, which is a different folder entirely", async () => {
    const dirs = await scratch();
    const staging = await source(path.join(dirs.projectDir, "..", "staging"));

    const { imported } = await importSkillDir({
      ...dirs,
      stagingDir: staging,
      scope: "user",
    });

    assert.equal(imported[0]!.dir, path.join(dirs.configDir, "skills", "pdf-forms"));
  });

  it("carries the supporting files across and reports them", async () => {
    const dirs = await scratch();
    const staging = await source(path.join(dirs.projectDir, "..", "staging"), {
      extra: { "references/api.md": "# api", "scripts/run.sh": "echo hi" },
    });

    const { imported } = await importSkillDir({
      ...dirs,
      stagingDir: staging,
      scope: "project",
    });
    const skill = imported[0]!;

    assert.deepEqual(skill.files, ["references/api.md", "scripts/run.sh"]);
    assert.equal(
      await readFile(path.join(skill.dir, "references", "api.md"), "utf8"),
      "# api",
    );
  });

  it("takes the operator's name over the one the skill gives itself", async () => {
    const dirs = await scratch();
    const staging = await source(path.join(dirs.projectDir, "..", "staging"));

    const { imported } = await importSkillDir({
      ...dirs,
      stagingDir: staging,
      scope: "project",
      name: "renamed",
    });

    assert.equal(imported[0]!.name, "renamed");
    assert.equal(path.basename(imported[0]!.dir), "renamed");
  });

  it("refuses a second skill of the same name in the same scope", async () => {
    const dirs = await scratch();
    const staging = await source(path.join(dirs.projectDir, "..", "staging"));

    await importSkillDir({ ...dirs, stagingDir: staging, scope: "project" });
    const again = await importSkillDir({
      ...dirs,
      stagingDir: staging,
      scope: "project",
    });

    // Skipped, not thrown: re-importing a source that gained one skill has to
    // install that one and pass over the rest.
    assert.deepEqual(again.imported, []);
    assert.deepEqual(again.skipped, [
      { name: "pdf-forms", reason: "already installed" },
    ]);
  });

  it("allows the same name in the other scope, which is what shadowing means", async () => {
    const dirs = await scratch();
    const staging = await source(path.join(dirs.projectDir, "..", "staging"));

    await importSkillDir({ ...dirs, stagingDir: staging, scope: "user" });
    await importSkillDir({ ...dirs, stagingDir: staging, scope: "project" });

    const all = await readSkills(dirs);
    assert.equal(all.length, 2);
    // The winner leads, and the loser says why it is not the one running.
    assert.equal(all[0]?.scope, "project");
    assert.equal(all[0]?.shadowed, undefined);
    assert.equal(all[1]?.scope, "user");
    assert.equal(all[1]?.shadowed, true);
  });

  it("refuses a source with no description — the CLI matches tasks on it", async () => {
    const dirs = await scratch();
    const staging = await source(path.join(dirs.projectDir, "..", "staging"), {
      description: "",
    });

    const outcome = await importSkillDir({
      ...dirs,
      stagingDir: staging,
      scope: "project",
    });
    assert.deepEqual(outcome.imported, []);
    assert.match(outcome.skipped[0]?.reason ?? "", /no description/);
  });

  it("refuses a source that is not a skill, and leaves nothing behind", async () => {
    const dirs = await scratch();
    const staging = path.join(dirs.projectDir, "..", "empty");
    await mkdir(staging, { recursive: true });
    await writeFile(path.join(staging, "README.md"), "not a skill", "utf8");

    await assert.rejects(
      importSkillDir({ ...dirs, stagingDir: staging, scope: "project" }),
      /no skill found/,
    );
    assert.deepEqual(await readSkills(dirs), []);
  });

  it("refuses a name no path can be composed from", async () => {
    const dirs = await scratch();
    const staging = await source(path.join(dirs.projectDir, "..", "staging"), {
      name: "../escape",
    });

    const outcome = await importSkillDir({
      ...dirs,
      stagingDir: staging,
      scope: "project",
    });
    assert.deepEqual(outcome.imported, []);
    assert.match(outcome.skipped[0]?.reason ?? "", /lowercase letters/);
  });

  it("does not follow a symlink out of the source", async () => {
    const dirs = await scratch();
    const staging = await source(path.join(dirs.projectDir, "..", "staging"));
    const secret = path.join(dirs.projectDir, "..", "secret.txt");
    await writeFile(secret, "do not copy me", "utf8");
    await symlink(secret, path.join(staging, "leak.txt"));

    const { imported } = await importSkillDir({
      ...dirs,
      stagingDir: staging,
      scope: "project",
    });

    // The link is copied as a link, never as the bytes it points at — so
    // removing the skill cannot have removed the target either.
    const copied = path.join(imported[0]!.dir, "leak.txt");
    const stat = await import("node:fs/promises").then((fs) => fs.lstat(copied));
    assert.equal(stat.isSymbolicLink(), true);
  });
});

describe("findSkillSources", () => {
  it("takes the root itself when SKILL.md is right there", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "overseer-locate-"));
    await source(root);

    const found = await findSkillSources(root);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.kind, "dir");
    assert.equal(found[0]?.path, root);
  });

  it("finds a skill one level down, which is where a clone puts it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "overseer-locate-"));
    await source(path.join(root, "pdf-forms"));

    const found = await findSkillSources(root);
    assert.deepEqual(
      found.map((f) => f.path),
      [path.join(root, "pdf-forms")],
    );
  });

  it("finds a skill two levels down, which is how collections are laid out", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "overseer-locate-"));
    await source(path.join(root, "skills", "pdf-forms"));

    const found = await findSkillSources(root);
    assert.deepEqual(
      found.map((f) => f.path),
      [path.join(root, "skills", "pdf-forms")],
    );
  });

  it("accepts a flat .md as a skill — a skill need not be a folder", async () => {
    // The shape published collections actually use: `skills/diagnose.md`, not
    // `skills/diagnose/SKILL.md`.
    const root = await mkdtemp(path.join(tmpdir(), "overseer-locate-"));
    const file = await flat(path.join(root, "skills", "diagnose.md"));

    const found = await findSkillSources(root);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.kind, "file");
    assert.equal(found[0]?.path, file);
    assert.equal(found[0]?.skill.name, "diagnose");
  });

  it("takes a flat .md pointed at directly", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "overseer-locate-"));
    const file = await flat(path.join(root, "diagnose.md"));

    const found = await findSkillSources(file);
    assert.deepEqual(found.map((f) => f.kind), ["file"]);
  });

  it("finds every skill in a flat collection, in name order", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "overseer-locate-"));
    for (const name of ["janitor", "diagnose", "changelog"]) {
      await flat(path.join(root, "skills", `${name}.md`), { name });
    }

    const found = await findSkillSources(root);
    assert.deepEqual(
      found.map((f) => f.skill.name),
      ["changelog", "diagnose", "janitor"],
    );
  });

  it("passes over a markdown file with no description", async () => {
    // The description is what a task gets matched against, so a file without
    // one is a document, not a skill. This is what keeps a README out.
    const root = await mkdtemp(path.join(tmpdir(), "overseer-locate-"));
    await flat(path.join(root, "skills", "real.md"), { name: "real" });
    await mkdir(path.join(root, "skills"), { recursive: true });
    await writeFile(path.join(root, "skills", "README.md"), "# docs\n", "utf8");

    const found = await findSkillSources(root);
    assert.deepEqual(found.map((f) => f.skill.name), ["real"]);
  });

  it("passes over an _-prefixed template", async () => {
    // `_template.md` carries a well-formed placeholder description, so nothing
    // but the naming convention distinguishes it from a real skill.
    const root = await mkdtemp(path.join(tmpdir(), "overseer-locate-"));
    await flat(path.join(root, "skills", "real.md"), { name: "real" });
    await flat(path.join(root, "skills", "_template.md"), {
      name: "your-skill-name",
      description: "What this does. Use when <trigger>.",
    });

    const found = await findSkillSources(root);
    assert.deepEqual(found.map((f) => f.skill.name), ["real"]);
  });

  it("mixes both shapes in one source", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "overseer-locate-"));
    await source(path.join(root, "skills", "pdf-forms"));
    await flat(path.join(root, "skills", "diagnose.md"));

    const found = await findSkillSources(root);
    assert.deepEqual(
      found.map((f) => `${f.kind}:${f.skill.name}`),
      ["file:diagnose", "dir:pdf-forms"],
    );
  });

  it("does not mistake a skill's own reference files for more skills", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "overseer-locate-"));
    const skill = await source(path.join(root, "pdf-forms"));
    await flat(path.join(skill, "references", "api.md"), { name: "api" });

    // A skill folder is a leaf; the walk must not descend into it.
    const found = await findSkillSources(root);
    assert.deepEqual(found.map((f) => f.skill.name), ["pdf-forms"]);
  });

  it("reports nothing when there is no skill at all", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "overseer-locate-"));
    await mkdir(path.join(root, "docs"), { recursive: true });

    assert.deepEqual(await findSkillSources(root), []);
  });
});

describe("importSkillDir, in bulk", () => {
  it("installs every skill in a flat collection", async () => {
    const dirs = await scratch();
    const staging = path.join(dirs.projectDir, "..", "collection");
    for (const name of ["changelog", "diagnose", "janitor"]) {
      await flat(path.join(staging, "skills", `${name}.md`), { name });
    }
    await flat(path.join(staging, "skills", "_template.md"), {
      name: "your-skill-name",
    });

    const { imported, skipped } = await importSkillDir({
      ...dirs,
      stagingDir: staging,
      scope: "project",
    });

    assert.deepEqual(
      imported.map((s) => s.name),
      ["changelog", "diagnose", "janitor"],
    );
    // The template is not a skipped skill — it was never a candidate.
    assert.deepEqual(skipped, []);

    // Each landed as the folder the CLI expects, with the file as its SKILL.md.
    const installed = await readSkills(dirs);
    assert.deepEqual(installed.map((s) => s.name), ["changelog", "diagnose", "janitor"]);
    assert.match(
      await readFile(path.join(installed[1]!.dir, "SKILL.md"), "utf8"),
      /name: diagnose/,
    );
  });

  it("installs the new one and skips the rest on a re-import", async () => {
    const dirs = await scratch();
    const staging = path.join(dirs.projectDir, "..", "collection");
    for (const name of ["changelog", "diagnose"]) {
      await flat(path.join(staging, "skills", `${name}.md`), { name });
    }
    await importSkillDir({ ...dirs, stagingDir: staging, scope: "project" });

    await flat(path.join(staging, "skills", "janitor.md"), { name: "janitor" });
    const { imported, skipped } = await importSkillDir({
      ...dirs,
      stagingDir: staging,
      scope: "project",
    });

    assert.deepEqual(imported.map((s) => s.name), ["janitor"]);
    assert.deepEqual(
      skipped.map((s) => `${s.name}:${s.reason}`),
      ["changelog:already installed", "diagnose:already installed"],
    );
  });

  it("refuses a name when the source holds several", async () => {
    const dirs = await scratch();
    const staging = path.join(dirs.projectDir, "..", "collection");
    for (const name of ["changelog", "diagnose"]) {
      await flat(path.join(staging, "skills", `${name}.md`), { name });
    }

    // One name cannot stand for two skills, and applying it to one would be a
    // guess about which.
    await assert.rejects(
      importSkillDir({
        ...dirs,
        stagingDir: staging,
        scope: "project",
        name: "renamed",
      }),
      /a name can only be given to one/,
    );
  });

  it("names a flat skill from its frontmatter, not its filename", async () => {
    const dirs = await scratch();
    const staging = path.join(dirs.projectDir, "..", "one");
    await flat(path.join(staging, "notes.md"), { name: "diagnose" });

    const { imported } = await importSkillDir({
      ...dirs,
      stagingDir: staging,
      scope: "project",
    });

    assert.equal(imported[0]!.name, "diagnose");
    assert.equal(path.basename(imported[0]!.dir), "diagnose");
  });

  it("falls back to the filename when the frontmatter names nothing", async () => {
    const dirs = await scratch();
    const staging = path.join(dirs.projectDir, "..", "one");
    await flat(path.join(staging, "diagnose.md"), { name: "" });

    const { imported } = await importSkillDir({
      ...dirs,
      stagingDir: staging,
      scope: "project",
    });

    assert.equal(imported[0]!.name, "diagnose");
    // The written SKILL.md declares it, so folder and declaration agree.
    assert.match(
      await readFile(path.join(imported[0]!.dir, "SKILL.md"), "utf8"),
      /name: diagnose/,
    );
  });

  it("installs the good ones and skips the bad in the same source", async () => {
    const dirs = await scratch();
    const staging = path.join(dirs.projectDir, "..", "mixed");
    await flat(path.join(staging, "skills", "good.md"), { name: "good" });
    await flat(path.join(staging, "skills", "bad.md"), { name: "Not Kebab" });

    const { imported, skipped } = await importSkillDir({
      ...dirs,
      stagingDir: staging,
      scope: "project",
    });

    assert.deepEqual(imported.map((s) => s.name), ["good"]);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0]!.reason, /lowercase letters/);
  });
});

describe("resolveSkillName", () => {
  it("prefers the override, then the frontmatter, then the folder", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "overseer-name-"));
    const declared = await source(path.join(root, "on-disk-name"), {
      name: "declared-name",
    });

    assert.equal(await resolveSkillName(declared, "override"), "override");
    assert.equal(await resolveSkillName(declared), "declared-name");

    const bare = path.join(root, "folder-name");
    await mkdir(bare, { recursive: true });
    await writeFile(path.join(bare, "SKILL.md"), "no frontmatter\n", "utf8");
    assert.equal(await resolveSkillName(bare), "folder-name");
  });
});

describe("deleteSkillDir", () => {
  it("removes the folder but keeps the skills directory", async () => {
    const dirs = await scratch();
    const staging = await source(path.join(dirs.projectDir, "..", "staging"));
    await importSkillDir({ ...dirs, stagingDir: staging, scope: "project" });

    await deleteSkillDir({ ...dirs, name: "pdf-forms", scope: "project" });

    assert.deepEqual(await readSkills(dirs), []);
    // An empty skills folder is not litter — the operator may have made it.
    const { readdir } = await import("node:fs/promises");
    assert.deepEqual(await readdir(skillsDirFor("project", dirs)), []);
  });

  it("refuses a name that is not there", async () => {
    const dirs = await scratch();
    await assert.rejects(
      deleteSkillDir({ ...dirs, name: "absent", scope: "project" }),
      /no project skill named absent/,
    );
  });

  it("removes only the scope it was asked for", async () => {
    const dirs = await scratch();
    const staging = await source(path.join(dirs.projectDir, "..", "staging"));
    await importSkillDir({ ...dirs, stagingDir: staging, scope: "user" });
    await importSkillDir({ ...dirs, stagingDir: staging, scope: "project" });

    await deleteSkillDir({ ...dirs, name: "pdf-forms", scope: "project" });

    const left = await readSkills(dirs);
    assert.equal(left.length, 1);
    assert.equal(left[0]?.scope, "user");
    // No longer hidden by anything.
    assert.equal(left[0]?.shadowed, undefined);
  });
});
