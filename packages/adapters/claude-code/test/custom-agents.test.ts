import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  parseAgentFrontmatter,
  readCustomAgents,
} from "../src/custom-agents.js";

/** A real agent file, shape taken from `~/.claude/agents/developer.md`. */
function agentFile(name: string, description: string): string {
  return `---
name: ${name}
description: ${description}
tools: Read, Edit, Write, Bash
model: opus
---

You are the ${name}.
`;
}

async function scratch(): Promise<{ projectDir: string; configDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "overseer-agents-"));
  return {
    projectDir: path.join(root, "project"),
    configDir: path.join(root, "config"),
  };
}

async function write(dir: string, file: string, body: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, file), body, "utf8");
}

describe("parseAgentFrontmatter", () => {
  it("reads name and description out of the leading block", () => {
    assert.deepEqual(
      parseAgentFrontmatter(agentFile("reviewer", "Reviews code for bugs")),
      { name: "reviewer", description: "Reviews code for bugs" },
    );
  });

  it("unwraps a quoted value", () => {
    const source = `---\nname: "code reviewer"\ndescription: 'Finds bugs'\n---\n`;
    assert.deepEqual(parseAgentFrontmatter(source), {
      name: "code reviewer",
      description: "Finds bugs",
    });
  });

  it("stops at the closing marker", () => {
    const source = `---\nname: real\n---\n\nname: not-frontmatter\n`;
    assert.equal(parseAgentFrontmatter(source).name, "real");
  });

  it("returns nothing for a file with no frontmatter", () => {
    assert.deepEqual(parseAgentFrontmatter("# just a heading\n"), {});
    assert.deepEqual(parseAgentFrontmatter(""), {});
  });
});

describe("readCustomAgents", () => {
  it("offers only 'none' when the operator has written no agents", async () => {
    const dirs = await scratch();
    const agents = await readCustomAgents(dirs);
    // The row still works — it just says the operator has none yet.
    assert.deepEqual(agents, [
      {
        value: "",
        label: "none",
        detail: "no custom subagent — Claude runs the turn itself",
      },
    ]);
  });

  it("reads the operator's agents from both scopes, behind 'none'", async () => {
    const dirs = await scratch();
    await write(
      path.join(dirs.configDir, "agents"),
      "developer.md",
      agentFile("developer", "Implements features"),
    );
    await write(
      path.join(dirs.projectDir, ".claude", "agents"),
      "reviewer.md",
      agentFile("reviewer", "Reviews code for bugs"),
    );

    const agents = await readCustomAgents(dirs);
    assert.deepEqual(
      agents.map((a) => a.value),
      ["", "developer", "reviewer"],
    );
    assert.equal(agents[2]?.detail, "Reviews code for bugs");
  });

  it("lets a project agent override a user one of the same name", async () => {
    const dirs = await scratch();
    await write(
      path.join(dirs.configDir, "agents"),
      "reviewer.md",
      agentFile("reviewer", "the user-level one"),
    );
    await write(
      path.join(dirs.projectDir, ".claude", "agents"),
      "reviewer.md",
      agentFile("reviewer", "the project one"),
    );

    const agents = await readCustomAgents(dirs);
    assert.equal(agents.length, 2);
    assert.equal(agents[1]?.detail, "the project one");
  });

  it("falls back to the filename when frontmatter names nothing", async () => {
    const dirs = await scratch();
    await write(
      path.join(dirs.projectDir, ".claude", "agents"),
      "bare-agent.md",
      "no frontmatter here\n",
    );
    const agents = await readCustomAgents(dirs);
    assert.equal(agents[1]?.value, "bare-agent");
    assert.equal(agents[1]?.detail, undefined);
  });

  it("prefers the frontmatter name over the filename", async () => {
    const dirs = await scratch();
    await write(
      path.join(dirs.projectDir, ".claude", "agents"),
      "file-name.md",
      agentFile("declared-name", "d"),
    );
    assert.equal((await readCustomAgents(dirs))[1]?.value, "declared-name");
  });

  it("ignores anything that is not a markdown file", async () => {
    const dirs = await scratch();
    const dir = path.join(dirs.projectDir, ".claude", "agents");
    await write(dir, "README.txt", "not an agent");
    await write(dir, "notes.json", "{}");
    await write(dir, "real.md", agentFile("real", "d"));

    assert.deepEqual(
      (await readCustomAgents(dirs)).map((a) => a.value),
      ["", "real"],
    );
  });

  it("sorts by name so the row does not reshuffle between reads", async () => {
    const dirs = await scratch();
    const dir = path.join(dirs.projectDir, ".claude", "agents");
    for (const name of ["zebra", "Alpha", "middle"]) {
      await write(dir, `${name}.md`, agentFile(name, "d"));
    }
    assert.deepEqual(
      (await readCustomAgents(dirs)).map((a) => a.value),
      ["", "Alpha", "middle", "zebra"],
    );
  });
});
