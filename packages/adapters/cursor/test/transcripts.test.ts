import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  deleteSession,
  findProjectDirForSession,
  listProjectSessions,
  lookupSessionTitle,
  readSessionHistory,
} from "../src/transcripts.js";

/** transcripts.ts reads `process.env.HOME` internally (mirroring the real
 * CLI's own `$HOME`-scoped config, verified live) — pointing it at a tmpdir
 * is the seam these tests use, restored in `after`. */
let home = "";
let originalHome: string | undefined;

async function writeTranscript(
  slug: string,
  chatId: string,
  lines: unknown[],
  meta: { createdAtMs: number; updatedAtMs: number; cwd: string },
): Promise<void> {
  const transcriptDir = path.join(home, ".cursor", "projects", slug, "agent-transcripts", chatId);
  await mkdir(transcriptDir, { recursive: true });
  await writeFile(
    path.join(transcriptDir, `${chatId}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    "utf8",
  );

  const chatDir = path.join(home, ".cursor", "chats", `hash-of-${slug}`, chatId);
  await mkdir(chatDir, { recursive: true });
  await writeFile(path.join(chatDir, "meta.json"), JSON.stringify(meta), "utf8");
}

async function trustProject(slug: string, workspacePath: string): Promise<void> {
  const dir = path.join(home, ".cursor", "projects", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, ".workspace-trusted"),
    JSON.stringify({ trustedAt: "2026-01-01T00:00:00.000Z", workspacePath, trustMethod: "cli-flag" }),
    "utf8",
  );
}

const userTurn = (text: string) => ({
  role: "user",
  message: { content: [{ type: "text", text: `<timestamp>x</timestamp>\n<user_query>\n${text}\n</user_query>` }] },
});
const agentTurn = (text: string) => ({
  role: "assistant",
  message: { content: [{ type: "text", text }] },
});

describe("cursor transcripts", () => {
  before(async () => {
    home = await mkdtemp(path.join(tmpdir(), "cursor-home-"));
    originalHome = process.env.HOME;
    process.env.HOME = home;
  });

  after(async () => {
    process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  });

  it("lists nothing for a project this adapter never trusted", async () => {
    assert.deepEqual(await listProjectSessions("/never/opened"), []);
  });

  it("lists sessions for a trusted project, titled from the first user turn", async () => {
    await trustProject("demo", "/workspace/demo");
    await writeTranscript(
      "demo",
      "chat-1",
      [userTurn("Reply with PONG."), agentTurn("PONG"), { type: "turn_ended", status: "success" }],
      { createdAtMs: 1000, updatedAtMs: 2000, cwd: "/workspace/demo" },
    );

    const sessions = await listProjectSessions("/workspace/demo");
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.id, "chat-1");
    assert.equal(sessions[0]?.adapterId, "cursor");
    assert.equal(sessions[0]?.status, "dormant");
    // Short enough to survive truncateTitle's 35-char cap untouched — that
    // cap has its own dedicated test below.
    assert.equal(sessions[0]?.name, "Reply with PONG.");
    assert.equal(sessions[0]?.createdAt, new Date(1000).toISOString());
    assert.equal(sessions[0]?.lastActiveAt, new Date(2000).toISOString());
  });

  it("truncates a long title the same way claude-code's does", async () => {
    await trustProject("demo2", "/workspace/demo2");
    const long = "a".repeat(60);
    await writeTranscript("demo2", "chat-long", [userTurn(long)], {
      createdAtMs: 1,
      updatedAtMs: 1,
      cwd: "/workspace/demo2",
    });
    const title = await lookupSessionTitle("/workspace/demo2", "chat-long");
    assert.equal(title?.length, 35);
    assert.ok(title?.endsWith("…"));
  });

  it("reads turns back with the <user_query> envelope stripped, agent text untouched", async () => {
    await trustProject("demo3", "/workspace/demo3");
    await writeTranscript(
      "demo3",
      "chat-3",
      [userTurn("hello"), agentTurn("hi there")],
      { createdAtMs: 1, updatedAtMs: 1, cwd: "/workspace/demo3" },
    );
    const turns = await readSessionHistory("/workspace/demo3", "chat-3");
    assert.deepEqual(
      turns.map((t) => ("text" in t ? t.text : undefined)),
      ["hello", "hi there"],
    );
    assert.equal(turns[0]?.kind, "user");
    assert.equal(turns[1]?.kind, "agent");
  });

  it("finds the project dir for a session id by scanning chats/*/<id>/meta.json", async () => {
    await trustProject("demo4", "/workspace/demo4");
    await writeTranscript("demo4", "chat-4", [userTurn("x")], {
      createdAtMs: 1,
      updatedAtMs: 1,
      cwd: "/workspace/demo4",
    });
    assert.equal(await findProjectDirForSession("chat-4"), "/workspace/demo4");
  });

  it("throws for an unknown session id", async () => {
    await assert.rejects(() => findProjectDirForSession("nope"));
  });

  it("deletes a session's transcript from both projects/ and chats/, idempotently", async () => {
    await trustProject("demo5", "/workspace/demo5");
    await writeTranscript("demo5", "chat-5", [userTurn("x")], {
      createdAtMs: 1,
      updatedAtMs: 1,
      cwd: "/workspace/demo5",
    });

    await deleteSession("/workspace/demo5", "chat-5");
    assert.deepEqual(await listProjectSessions("/workspace/demo5"), []);
    await assert.rejects(() => findProjectDirForSession("chat-5"));

    // Idempotent — already gone is not an error.
    await deleteSession("/workspace/demo5", "chat-5");
  });
});
