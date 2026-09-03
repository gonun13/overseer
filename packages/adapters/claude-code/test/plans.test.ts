import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { listPlansForProject } from "../src/plans.js";
import { projectDirSlug } from "../src/project-slug.js";

/**
 * Plans are read back out of the CLI's own transcripts, so the fixtures here
 * are real JSONL files in the layout the CLI writes — the contract under test
 * is with that format, not with our idea of it.
 */

const projectDir = "/workspace/demo";
const dirs: string[] = [];

after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

function planRecord(
  id: string,
  plan: string,
  timestamp: string,
): string {
  return JSON.stringify({
    type: "assistant",
    uuid: id,
    timestamp,
    cwd: projectDir,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name: "ExitPlanMode", input: { plan } }],
    },
  });
}

function toolRecord(name: string, timestamp: string): string {
  return JSON.stringify({
    type: "assistant",
    uuid: `${name}-${timestamp}`,
    timestamp,
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", id: `t-${timestamp}`, name, input: { file_path: "/workspace/demo/a.ts" } },
      ],
    },
  });
}

async function configWith(
  transcripts: Record<string, string[]>,
): Promise<string> {
  const configDir = await mkdtemp(path.join(tmpdir(), "claude-plans-"));
  dirs.push(configDir);
  const slugDir = path.join(configDir, "projects", projectDirSlug(projectDir));
  await mkdir(slugDir, { recursive: true });
  for (const [sessionId, lines] of Object.entries(transcripts)) {
    await writeFile(path.join(slugDir, `${sessionId}.jsonl`), lines.join("\n"));
  }
  return configDir;
}

describe("listPlansForProject", () => {
  it("reports no plans for a project the CLI has never written to", async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), "claude-plans-"));
    dirs.push(configDir);
    assert.deepEqual(await listPlansForProject(configDir, projectDir), []);
  });

  it("lifts the plan markdown and titles it from its first line", async () => {
    const configDir = await configWith({
      s1: [planRecord("p1", "# Ship the thing\n\nstep one", "2026-09-01T10:00:00Z")],
    });
    const plans = await listPlansForProject(configDir, projectDir);
    assert.equal(plans.length, 1);
    assert.equal(plans[0]?.id, "p1");
    assert.equal(plans[0]?.sessionId, "s1");
    assert.equal(plans[0]?.title, "Ship the thing");
    assert.match(plans[0]?.body ?? "", /step one/);
    assert.equal(plans[0]?.derived, "proposed");
  });

  it("passes over a bare section header for the prose under it", async () => {
    const configDir = await configWith({
      s1: [
        planRecord(
          "p1",
          "## Context\n\nnote.txt says hello and should say hello world.\n\n## Change\n- edit line 1",
          "2026-09-01T10:00:00Z",
        ),
      ],
    });
    const plans = await listPlansForProject(configDir, projectDir);
    assert.equal(
      plans[0]?.title,
      "note.txt says hello and should say hello world.",
    );
  });

  it("truncates a title too long for a row", async () => {
    const configDir = await configWith({
      s1: [planRecord("p1", `# ${"long ".repeat(30)}`, "2026-09-01T10:00:00Z")],
    });
    assert.equal((await listPlansForProject(configDir, projectDir))[0]?.title.length, 72);
  });

  it("calls a plan in progress once the session edits anything after it", async () => {
    const configDir = await configWith({
      s1: [
        planRecord("p1", "# Do it", "2026-09-01T10:00:00Z"),
        toolRecord("Edit", "2026-09-01T10:05:00Z"),
      ],
    });
    const plans = await listPlansForProject(configDir, projectDir);
    assert.equal(plans[0]?.derived, "in-progress");
  });

  it("ignores reads that follow a plan — looking is not implementing", async () => {
    const configDir = await configWith({
      s1: [
        planRecord("p1", "# Do it", "2026-09-01T10:00:00Z"),
        toolRecord("Read", "2026-09-01T10:05:00Z"),
      ],
    });
    const plans = await listPlansForProject(configDir, projectDir);
    assert.equal(plans[0]?.derived, "proposed");
  });

  it("supersedes a plan the same session replaced with a newer one", async () => {
    const configDir = await configWith({
      s1: [
        planRecord("p1", "# First idea", "2026-09-01T10:00:00Z"),
        planRecord("p2", "# Second idea", "2026-09-01T11:00:00Z"),
      ],
    });
    const plans = await listPlansForProject(configDir, projectDir);
    // Newest first.
    assert.deepEqual(
      plans.map((plan) => [plan.id, plan.derived]),
      [
        ["p2", "proposed"],
        ["p1", "superseded"],
      ],
    );
  });

  it("reads every session in the project, newest plan first", async () => {
    const configDir = await configWith({
      s1: [planRecord("p1", "# Older", "2026-09-01T10:00:00Z")],
      s2: [planRecord("p2", "# Newer", "2026-09-02T10:00:00Z")],
    });
    const plans = await listPlansForProject(configDir, projectDir);
    assert.deepEqual(plans.map((plan) => plan.id), ["p2", "p1"]);
  });

  it("skips an ExitPlanMode call carrying no plan text", async () => {
    const configDir = await configWith({
      s1: [
        JSON.stringify({
          type: "assistant",
          uuid: "p1",
          timestamp: "2026-09-01T10:00:00Z",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", id: "p1", name: "ExitPlanMode", input: {} }],
          },
        }),
        "{ not json",
      ],
    });
    assert.deepEqual(await listPlansForProject(configDir, projectDir), []);
  });
});
