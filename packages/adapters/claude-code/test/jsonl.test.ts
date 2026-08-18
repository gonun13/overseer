import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  backfillHistory,
  deleteSessionTranscript,
  listSessionsForProject,
} from "../src/jsonl.js";
import { projectDirSlug } from "../src/project-slug.js";

describe("projectDirSlug", () => {
  it("replaces non-alphanumeric characters with hyphens", () => {
    assert.equal(projectDirSlug("/workspace/my-app"), "-workspace-my-app");
    assert.equal(projectDirSlug("/workspace/foo.bar"), "-workspace-foo-bar");
  });
});

describe("jsonl backfill", () => {
  let configDir = "";
  const projectDir = "/workspace/demo";
  const sessionId = "11111111-2222-3333-4444-555555555555";

  after(async () => {
    if (configDir !== "") {
      const { rm } = await import("node:fs/promises");
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("lists and backfills a simple conversation", async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "claude-jsonl-"));
    const slugDir = path.join(
      configDir,
      "projects",
      projectDirSlug(projectDir),
    );
    await mkdir(slugDir, { recursive: true });
    const jsonl = [
      JSON.stringify({
        type: "user",
        uuid: "u1",
        parentUuid: null,
        sessionId,
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: projectDir,
        gitBranch: "main",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        sessionId,
        timestamp: "2026-01-01T00:00:01.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello back" }],
        },
      }),
    ].join("\n");
    await writeFile(path.join(slugDir, `${sessionId}.jsonl`), jsonl);

    const listed = await listSessionsForProject(configDir, projectDir);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, sessionId);
    assert.equal(listed[0]?.gitBranch, "main");

    const turns = await backfillHistory(configDir, projectDir, sessionId);
    assert.deepEqual(turns, [
      { id: "u1", kind: "user", text: "hi" },
      { id: "a1", kind: "agent", text: "hello back" },
    ]);
  });

  it("removes a session's transcript so it no longer lists", async () => {
    const doomedId = "99999999-8888-7777-6666-555555555555";
    const slugDir = path.join(
      configDir,
      "projects",
      projectDirSlug(projectDir),
    );
    await writeFile(
      path.join(slugDir, `${doomedId}.jsonl`),
      JSON.stringify({
        type: "user",
        uuid: "u1",
        parentUuid: null,
        sessionId: doomedId,
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: projectDir,
        message: { role: "user", content: [{ type: "text", text: "bye" }] },
      }),
    );
    assert.ok(
      (await listSessionsForProject(configDir, projectDir)).some(
        (s) => s.id === doomedId,
      ),
    );

    await deleteSessionTranscript(configDir, projectDir, doomedId);

    assert.equal(
      (await listSessionsForProject(configDir, projectDir)).some(
        (s) => s.id === doomedId,
      ),
      false,
    );
    // Deleting again — e.g. a duplicate click — is a no-op, not an error.
    await deleteSessionTranscript(configDir, projectDir, doomedId);
  });
});
