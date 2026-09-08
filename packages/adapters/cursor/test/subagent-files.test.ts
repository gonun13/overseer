import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { SubagentDraft } from "@overseer/protocol";
import { agentsDir, readSubagents } from "../src/custom-agents.js";
import {
  deleteSubagentFile,
  serializeAgentFile,
  writeSubagentFile,
} from "../src/subagent-files.js";

let projectDir = "";

const draft = (over: Partial<SubagentDraft> = {}): SubagentDraft => ({
  name: "reviewer",
  description: "Reviews diffs",
  prompt: "You review code.",
  model: "",
  tools: "",
  scope: "project",
  ...over,
});

async function writeAgent(entry: string, source: string): Promise<string> {
  const dir = agentsDir(projectDir);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, entry);
  await writeFile(file, source, "utf8");
  return file;
}

describe("cursor serializeAgentFile", () => {
  it("omits blank tools and model rather than writing them empty", () => {
    const out = serializeAgentFile(draft());
    assert.match(out, /^---\nname: reviewer\ndescription: Reviews diffs\n---\n\n/);
    assert.doesNotMatch(out, /tools:/);
    assert.doesNotMatch(out, /model:/);
  });

  it("quotes a value that would otherwise change meaning", () => {
    const out = serializeAgentFile(draft({ description: "yes" }));
    assert.match(out, /description: "yes"\n/);
  });

  it("replays keys this layer does not understand", () => {
    const out = serializeAgentFile(
      draft(),
      new Map([
        ["permissionMode", "plan"],
        ["isBackground", "true"],
      ]),
    );
    assert.match(out, /permissionMode: plan\n/);
    assert.match(out, /isBackground: "true"\n/);
  });
});

describe("cursor writeSubagentFile", () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(path.join(tmpdir(), "cursor-agents-w-"));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("creates .cursor/agents and lands the file in it", async () => {
    const written = await writeSubagentFile({ projectDir, draft: draft() });
    assert.equal(written.file, path.join(agentsDir(projectDir), "reviewer.md"));
    assert.equal(written.name, "reviewer");
    assert.equal(written.prompt, "You review code.");
  });

  it("round-trips a draft through the reader unchanged", async () => {
    const original = draft({ tools: "Read, Grep", model: "gpt-5", prompt: "Line one\n\nLine two" });
    await writeSubagentFile({ projectDir, draft: original });

    const [agent] = await readSubagents({ projectDir });
    assert.equal(agent?.name, original.name);
    assert.equal(agent?.description, original.description);
    assert.equal(agent?.tools, original.tools);
    assert.equal(agent?.model, original.model);
    assert.equal(agent?.prompt, original.prompt);
  });

  it("keeps cursor-only frontmatter the editor cannot represent", async () => {
    await writeAgent(
      "reviewer.md",
      ["---", "name: reviewer", "description: old", "permissionMode: plan", "isBackground: true", "---", "", "old body"].join("\n"),
    );

    await writeSubagentFile({
      projectDir,
      draft: draft({ description: "new", prompt: "new body" }),
      previous: { name: "reviewer", scope: "project" },
    });

    const source = await readFile(path.join(agentsDir(projectDir), "reviewer.md"), "utf8");
    assert.match(source, /description: new\n/);
    assert.match(source, /permissionMode: plan\n/);
    assert.match(source, /isBackground: "true"\n/);
    assert.match(source, /new body/);
  });

  it("refuses a user-scoped write instead of quietly writing it to the project", async () => {
    await assert.rejects(
      writeSubagentFile({ projectDir, draft: draft({ scope: "user" }) }),
      /no user-wide agents folder/,
    );
  });

  it("refuses a name no path can be composed from", async () => {
    await assert.rejects(
      writeSubagentFile({ projectDir, draft: draft({ name: "Not Valid" }) }),
      /not a usable subagent name/,
    );
  });

  it("refuses to clobber a different agent of the same name", async () => {
    await writeSubagentFile({ projectDir, draft: draft() });
    await assert.rejects(
      writeSubagentFile({ projectDir, draft: draft({ description: "another" }) }),
      /already exists/,
    );
  });

  it("renames by writing the new file and removing the old one", async () => {
    await writeSubagentFile({ projectDir, draft: draft() });
    await writeSubagentFile({
      projectDir,
      draft: draft({ name: "auditor" }),
      previous: { name: "reviewer", scope: "project" },
    });

    const names = (await readSubagents({ projectDir })).map((a) => a.name);
    assert.deepEqual(names, ["auditor"]);
  });

  it("replaces a .mdc file with a .md one when saved through the editor", async () => {
    await writeAgent("reviewer.mdc", ["---", "name: reviewer", "---", "", "body"].join("\n"));

    await writeSubagentFile({
      projectDir,
      draft: draft(),
      previous: { name: "reviewer", scope: "project" },
    });

    const files = (await readSubagents({ projectDir })).map((a) => path.basename(a.file));
    assert.deepEqual(files, ["reviewer.md"]);
  });
});

describe("cursor deleteSubagentFile", () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(path.join(tmpdir(), "cursor-agents-d-"));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("removes the file", async () => {
    await writeSubagentFile({ projectDir, draft: draft() });
    await deleteSubagentFile({ projectDir, name: "reviewer", scope: "project" });
    assert.deepEqual(await readSubagents({ projectDir }), []);
  });

  it("finds an agent whose filename disagrees with its name", async () => {
    await writeAgent("old-file.md", ["---", "name: reviewer", "---", "", "body"].join("\n"));
    await deleteSubagentFile({ projectDir, name: "reviewer", scope: "project" });
    assert.deepEqual(await readSubagents({ projectDir }), []);
  });

  it("refuses a user-scoped delete", async () => {
    await assert.rejects(
      deleteSubagentFile({ projectDir, name: "reviewer", scope: "user" }),
      /no user-wide agents folder/,
    );
  });

  it("says so when there is no such agent", async () => {
    await assert.rejects(
      deleteSubagentFile({ projectDir, name: "ghost", scope: "project" }),
      /no subagent named ghost/,
    );
  });
});
