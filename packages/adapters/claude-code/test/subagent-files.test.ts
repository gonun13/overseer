import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { SubagentDraft } from "@overseer/protocol";
import {
  parseAgentFrontmatter,
  readSubagents,
  splitFrontmatter,
} from "../src/custom-agents.js";
import {
  deleteSubagentFile,
  serializeAgentFile,
  writeSubagentFile,
} from "../src/subagent-files.js";

async function scratch(): Promise<{ projectDir: string; configDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "overseer-subagents-"));
  return {
    projectDir: path.join(root, "project"),
    configDir: path.join(root, "config"),
  };
}

function draft(over: Partial<SubagentDraft> = {}): SubagentDraft {
  return {
    name: "reviewer",
    description: "Reviews code for bugs",
    prompt: "You are the reviewer.",
    model: "",
    tools: "",
    scope: "project",
    ...over,
  };
}

async function write(dir: string, file: string, body: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, file), body, "utf8");
}

const projectAgents = (d: { projectDir: string }): string =>
  path.join(d.projectDir, ".claude", "agents");
const userAgents = (d: { configDir: string }): string =>
  path.join(d.configDir, "agents");

describe("serializeAgentFile", () => {
  /** The contract: whatever the writer emits, the reader gets back. */
  for (const [label, value] of [
    ["a plain description", "Reviews code for bugs"],
    ["one containing a colon-space", "Reviews code: finds bugs"],
    ['one containing a double quote', 'Says "no" a lot'],
    ["one containing a backslash", "Escapes \\ like this"],
    ["one that is a YAML boolean", "yes"],
    ["one that is a YAML null", "~"],
    ["one starting with an indicator", "#1 priority"],
    ["one starting with a dash", "- not a list"],
    ["one ending in a colon", "note:"],
  ] as const) {
    it(`round-trips ${label}`, () => {
      const source = serializeAgentFile(draft({ description: value }));
      assert.equal(parseAgentFrontmatter(source).description, value);
    });
  }

  it("leaves an ordinary name unquoted so the file stays hand-editable", () => {
    assert.match(serializeAgentFile(draft()), /^name: reviewer$/m);
  });

  it("omits tools and model when blank, rather than emitting them empty", () => {
    // An absent `tools` means inherit every tool; an empty one would not.
    const source = serializeAgentFile(draft());
    assert.doesNotMatch(source, /^tools:/m);
    assert.doesNotMatch(source, /^model:/m);
  });

  it("emits tools and model when set", () => {
    const source = serializeAgentFile(
      draft({ tools: "Read, Edit, Bash", model: "opus" }),
    );
    const { keys } = splitFrontmatter(source);
    assert.equal(keys.get("tools"), "Read, Edit, Bash");
    assert.equal(keys.get("model"), "opus");
  });

  it("keeps the body verbatim, including a --- line inside it", () => {
    const prompt = "Do the thing.\n\n---\n\nThen the other thing.";
    const source = serializeAgentFile(draft({ prompt }));
    assert.equal(splitFrontmatter(source).body, prompt);
  });

  it("flattens a value that would otherwise break the block onto one line", () => {
    const source = serializeAgentFile(
      draft({ description: "line one\nline two" }),
    );
    assert.equal(parseAgentFrontmatter(source).description, "line one line two");
  });

  it("normalises trailing whitespace to a single newline", () => {
    assert.ok(serializeAgentFile(draft({ prompt: "body\n\n\n" })).endsWith("body\n"));
  });
});

describe("readSubagents", () => {
  it("reports nothing when neither folder exists", async () => {
    assert.deepEqual(await readSubagents(await scratch()), []);
  });

  it("reports scope, absolute path and body for both folders", async () => {
    const dirs = await scratch();
    await write(
      projectAgents(dirs),
      "reviewer.md",
      serializeAgentFile(draft({ prompt: "Project prompt." })),
    );
    await write(
      userAgents(dirs),
      "developer.md",
      serializeAgentFile(draft({ name: "developer", scope: "user" })),
    );

    const agents = await readSubagents(dirs);
    assert.deepEqual(
      agents.map((a) => [a.name, a.scope]),
      [
        ["developer", "user"],
        ["reviewer", "project"],
      ],
    );
    const reviewer = agents.find((a) => a.name === "reviewer");
    assert.equal(reviewer?.prompt, "Project prompt.");
    assert.equal(reviewer?.file, path.join(projectAgents(dirs), "reviewer.md"));
  });

  it("lists both sides of a collision and marks the shadowed one", async () => {
    const dirs = await scratch();
    await write(projectAgents(dirs), "reviewer.md", serializeAgentFile(draft()));
    await write(
      userAgents(dirs),
      "reviewer.md",
      serializeAgentFile(draft({ scope: "user" })),
    );

    const agents = await readSubagents(dirs);
    assert.equal(agents.length, 2);
    // The one that wins leads.
    assert.equal(agents[0]?.scope, "project");
    assert.equal(agents[0]?.shadowed, undefined);
    assert.equal(agents[1]?.scope, "user");
    assert.equal(agents[1]?.shadowed, true);
  });

  it("flags a file whose frontmatter name disagrees with its filename", async () => {
    const dirs = await scratch();
    await write(
      projectAgents(dirs),
      "file-name.md",
      serializeAgentFile(draft({ name: "declared-name" })),
    );
    const [agent] = await readSubagents(dirs);
    assert.equal(agent?.name, "declared-name");
    assert.equal(agent?.renamedOnSave, true);
  });

  it("flags a name the write path could not compose a path from", async () => {
    const dirs = await scratch();
    await write(
      projectAgents(dirs),
      "reviewer.md",
      `---\nname: "code reviewer"\ndescription: d\n---\n\nbody\n`,
    );
    const [agent] = await readSubagents(dirs);
    assert.equal(agent?.name, "code reviewer");
    assert.equal(agent?.readOnly, true);
  });
});

describe("writeSubagentFile", () => {
  it("creates the agents folder a project does not have yet", async () => {
    const dirs = await scratch();
    const written = await writeSubagentFile({ ...dirs, draft: draft() });
    assert.equal(written.name, "reviewer");
    assert.equal(written.scope, "project");
    assert.equal(written.prompt, "You are the reviewer.");
    assert.equal(
      await readFile(path.join(projectAgents(dirs), "reviewer.md"), "utf8"),
      serializeAgentFile(draft()),
    );
  });

  it("returns what is on disk, not what was asked for", async () => {
    const dirs = await scratch();
    const written = await writeSubagentFile({
      ...dirs,
      draft: draft({ description: "Reviews code: finds bugs" }),
    });
    assert.equal(written.description, "Reviews code: finds bugs");
    assert.equal(written.file, path.join(projectAgents(dirs), "reviewer.md"));
  });

  it("refuses a name it cannot safely compose a path from", async () => {
    const dirs = await scratch();
    await assert.rejects(
      writeSubagentFile({ ...dirs, draft: draft({ name: "../escape" }) }),
      /not a usable subagent name/,
    );
  });

  it("refuses to overwrite a different agent that already has the name", async () => {
    const dirs = await scratch();
    await writeSubagentFile({ ...dirs, draft: draft() });
    await assert.rejects(
      writeSubagentFile({ ...dirs, draft: draft({ prompt: "different" }) }),
      /already exists/,
    );
  });

  it("overwrites in place when previous names the same file", async () => {
    const dirs = await scratch();
    await writeSubagentFile({ ...dirs, draft: draft() });
    const written = await writeSubagentFile({
      ...dirs,
      draft: draft({ prompt: "edited" }),
      previous: { name: "reviewer", scope: "project" },
    });
    assert.equal(written.prompt, "edited");
    assert.deepEqual(await readdir(projectAgents(dirs)), ["reviewer.md"]);
  });

  it("renames the file, leaving no copy behind", async () => {
    const dirs = await scratch();
    await writeSubagentFile({ ...dirs, draft: draft() });
    const written = await writeSubagentFile({
      ...dirs,
      draft: draft({ name: "auditor" }),
      previous: { name: "reviewer", scope: "project" },
    });
    assert.equal(written.name, "auditor");
    assert.deepEqual(await readdir(projectAgents(dirs)), ["auditor.md"]);
  });

  it("moves an agent between scopes", async () => {
    const dirs = await scratch();
    await writeSubagentFile({ ...dirs, draft: draft() });
    const written = await writeSubagentFile({
      ...dirs,
      draft: draft({ scope: "user" }),
      previous: { name: "reviewer", scope: "project" },
    });
    assert.equal(written.scope, "user");
    assert.deepEqual(await readdir(projectAgents(dirs)), []);
    assert.deepEqual(await readdir(userAgents(dirs)), ["reviewer.md"]);
  });

  it("renames a file whose filename never matched its frontmatter name", async () => {
    const dirs = await scratch();
    await write(
      projectAgents(dirs),
      "file-name.md",
      serializeAgentFile(draft({ name: "declared-name" })),
    );
    await writeSubagentFile({
      ...dirs,
      draft: draft({ name: "declared-name", prompt: "edited" }),
      previous: { name: "declared-name", scope: "project" },
    });
    // Resolved through the listing rather than recomposed, so the stale file
    // goes rather than surviving alongside the new one.
    assert.deepEqual(await readdir(projectAgents(dirs)), ["declared-name.md"]);
  });

  it("does not touch the other scope's agent of the same name", async () => {
    const dirs = await scratch();
    await writeSubagentFile({ ...dirs, draft: draft({ scope: "user" }) });
    await writeSubagentFile({ ...dirs, draft: draft({ prompt: "the project one" }) });
    assert.deepEqual(await readdir(userAgents(dirs)), ["reviewer.md"]);
    assert.deepEqual(await readdir(projectAgents(dirs)), ["reviewer.md"]);
  });
});

describe("deleteSubagentFile", () => {
  it("removes the named agent and leaves the folder in place", async () => {
    const dirs = await scratch();
    await writeSubagentFile({ ...dirs, draft: draft() });
    await deleteSubagentFile({ ...dirs, name: "reviewer", scope: "project" });
    assert.deepEqual(await readdir(projectAgents(dirs)), []);
  });

  it("leaves the other scope's agent of the same name alone", async () => {
    const dirs = await scratch();
    await writeSubagentFile({ ...dirs, draft: draft() });
    await writeSubagentFile({ ...dirs, draft: draft({ scope: "user" }) });
    await deleteSubagentFile({ ...dirs, name: "reviewer", scope: "project" });
    assert.deepEqual(await readdir(projectAgents(dirs)), []);
    assert.deepEqual(await readdir(userAgents(dirs)), ["reviewer.md"]);
  });

  it("deletes an agent whose name the write path would refuse", async () => {
    // The whole reason delete resolves through the listing: a hand-written
    // file with an unusable name is the one most worth being able to remove.
    const dirs = await scratch();
    await write(
      projectAgents(dirs),
      "odd.md",
      `---\nname: "code reviewer"\ndescription: d\n---\n\nbody\n`,
    );
    await deleteSubagentFile({ ...dirs, name: "code reviewer", scope: "project" });
    assert.deepEqual(await readdir(projectAgents(dirs)), []);
  });

  it("refuses when there is no such agent", async () => {
    const dirs = await scratch();
    await assert.rejects(
      deleteSubagentFile({ ...dirs, name: "missing", scope: "project" }),
      /no project subagent named missing/,
    );
  });
});
