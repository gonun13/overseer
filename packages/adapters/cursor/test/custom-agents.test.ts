import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { agentsDir, readSubagents, splitFrontmatter } from "../src/custom-agents.js";

let projectDir = "";

async function writeAgent(entry: string, source: string): Promise<string> {
  const dir = agentsDir(projectDir);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, entry);
  await writeFile(file, source, "utf8");
  return file;
}

const agentFile = (frontmatter: string[], body: string) =>
  ["---", ...frontmatter, "---", "", body].join("\n");

describe("cursor readSubagents", () => {
  beforeEach(async () => {
    projectDir = await mkdtemp(path.join(tmpdir(), "cursor-agents-"));
  });
  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("reports no agents when the folder does not exist", async () => {
    assert.deepEqual(await readSubagents({ projectDir }), []);
  });

  it("reads a file's frontmatter and body", async () => {
    const file = await writeAgent(
      "reviewer.md",
      agentFile(
        ["name: reviewer", "description: Reviews diffs", "tools: Read, Grep", "model: gpt-5"],
        "You review code.",
      ),
    );

    const [agent] = await readSubagents({ projectDir });
    assert.equal(agent?.name, "reviewer");
    assert.equal(agent?.description, "Reviews diffs");
    assert.equal(agent?.tools, "Read, Grep");
    assert.equal(agent?.model, "gpt-5");
    assert.equal(agent?.prompt, "You review code.");
    assert.equal(agent?.file, file);
  });

  it("scopes every agent to the project — cursor has no user-wide folder", async () => {
    await writeAgent("reviewer.md", agentFile(["name: reviewer"], "body"));

    const [agent] = await readSubagents({ projectDir });
    assert.equal(agent?.scope, "project");
    assert.equal(agent?.shadowed, undefined);
  });

  it("lists .mdc and .markdown, which the CLI's own globs accept", async () => {
    await writeAgent("one.md", agentFile(["name: one"], "a"));
    await writeAgent("two.mdc", agentFile(["name: two"], "b"));
    await writeAgent("three.markdown", agentFile(["name: three"], "c"));
    await writeAgent("notes.txt", "not an agent");

    const names = (await readSubagents({ projectDir })).map((a) => a.name);
    assert.deepEqual(names, ["one", "three", "two"]);
  });

  it("does not mark a .mdc file renamedOnSave for its extension alone", async () => {
    await writeAgent("reviewer.mdc", agentFile(["name: reviewer"], "body"));

    const [agent] = await readSubagents({ projectDir });
    assert.equal(agent?.renamedOnSave, undefined);
  });

  it("falls back to the filename stem when frontmatter names nothing", async () => {
    await writeAgent("reviewer.md", agentFile(["description: no name here"], "body"));

    const [agent] = await readSubagents({ projectDir });
    assert.equal(agent?.name, "reviewer");
    assert.equal(agent?.renamedOnSave, undefined);
  });

  it("flags a frontmatter name that disagrees with the filename", async () => {
    await writeAgent("old-name.md", agentFile(["name: new-name"], "body"));

    const [agent] = await readSubagents({ projectDir });
    assert.equal(agent?.name, "new-name");
    assert.equal(agent?.renamedOnSave, true);
  });

  it("marks a name no path can be composed from read-only", async () => {
    await writeAgent("odd.md", agentFile(["name: Not A Valid Name"], "body"));

    const [agent] = await readSubagents({ projectDir });
    assert.equal(agent?.readOnly, true);
  });

  it("keeps every key it matched, understood or not", () => {
    const { keys, body } = splitFrontmatter(
      agentFile(["name: a", "permissionMode: plan", "isBackground: true"], "prompt"),
    );
    assert.equal(keys.get("permissionMode"), "plan");
    assert.equal(keys.get("isBackground"), "true");
    assert.equal(body, "prompt");
  });
});
