import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { projectDirSlug } from "../src/project-slug.js";
import { resolveSessionTitle } from "../src/session-titles.js";

describe("resolveSessionTitle", () => {
  let configDir = "";
  const projectDir = "/workspace/demo";
  const sessionId = "11111111-2222-3333-4444-555555555555";

  after(async () => {
    if (configDir !== "") {
      const { rm } = await import("node:fs/promises");
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("prefers customTitle from sessions-index.json", async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "claude-titles-"));
    const slugDir = path.join(
      configDir,
      "projects",
      projectDirSlug(projectDir),
    );
    await mkdir(slugDir, { recursive: true });
    await writeFile(
      path.join(slugDir, "sessions-index.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            sessionId,
            customTitle: "payment refactor",
            firstPrompt: "fix the login bug",
          },
        ],
      }),
    );
    await writeFile(path.join(slugDir, `${sessionId}.jsonl`), "");

    assert.equal(
      await resolveSessionTitle(configDir, projectDir, sessionId),
      "payment refactor",
    );
  });

  it("falls back to the first user message in jsonl", async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "claude-titles-"));
    const slugDir = path.join(
      configDir,
      "projects",
      projectDirSlug(projectDir),
    );
    await mkdir(slugDir, { recursive: true });
    const jsonl = JSON.stringify({
      type: "user",
      uuid: "u1",
      message: {
        role: "user",
        content: [{ type: "text", text: "what is in this repo?" }],
      },
    });
    await writeFile(path.join(slugDir, `${sessionId}.jsonl`), jsonl);

    assert.equal(
      await resolveSessionTitle(configDir, projectDir, sessionId),
      "what is in this repo?",
    );
  });

  it("uses summary when index has no customTitle and jsonl has no user turn", async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "claude-titles-"));
    const slugDir = path.join(
      configDir,
      "projects",
      projectDirSlug(projectDir),
    );
    await mkdir(slugDir, { recursive: true });
    await writeFile(
      path.join(slugDir, "sessions-index.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            sessionId,
            summary: "Explored auth flow and fixed redirect",
          },
        ],
      }),
    );
    await writeFile(path.join(slugDir, `${sessionId}.jsonl`), "");

    assert.equal(
      await resolveSessionTitle(configDir, projectDir, sessionId),
      "Explored auth flow and fixed redir…",
    );
  });

  it("truncates long titles to 35 characters", async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "claude-titles-"));
    const slugDir = path.join(
      configDir,
      "projects",
      projectDirSlug(projectDir),
    );
    await mkdir(slugDir, { recursive: true });
    await writeFile(
      path.join(slugDir, "sessions-index.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            sessionId,
            customTitle: "this is a very long session title indeed",
          },
        ],
      }),
    );
    await writeFile(path.join(slugDir, `${sessionId}.jsonl`), "");

    assert.equal(
      await resolveSessionTitle(configDir, projectDir, sessionId),
      "this is a very long session title …",
    );
  });
});
