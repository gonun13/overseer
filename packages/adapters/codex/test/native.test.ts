import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import {
  AppServer,
  type ClientFactory,
  withClient,
} from "../src/app-server.js";
import { createCodexAdapter } from "../src/index.js";

// Real pinned CLI, isolated state, no account login and no model turns.
it("a named empty thread persists and resumes after App Server restarts", async () => {
  assert.equal(
    process.env.OVERSEER_IN_CONTAINER,
    "1",
    "native probes run only in Docker",
  );
  const root = await mkdtemp(path.join(tmpdir(), "overseer-codex-native-"));
  await mkdir(path.join(root, "home"));
  const factory: ClientFactory = async (timeoutMs) => {
    const env = { ...process.env, CODEX_HOME: path.join(root, "home") };
    delete env.OPENAI_API_KEY;
    const client = new AppServer({ timeoutMs, env });
    try {
      await client.initialize();
      return client;
    } catch (error) {
      await client.close();
      throw error;
    }
  };
  try {
    const adapter = createCodexAdapter(factory);
    const id = await adapter.sessions!.mintSessionId({ projectDir: root });
    assert.equal(
      await adapter.sessions!.lookupSessionTitle(root, id),
      "new session",
    );
    // The pinned CLI lists only threads with a first user message. A named
    // empty thread is still persisted and resumable by its native id.
    assert.deepEqual(await adapter.sessions!.listProjectSessions(root), []);
    const resumed = await withClient(factory, (client) =>
      client.request<{ thread: { id: string } }>("thread/resume", {
        threadId: id,
      }),
    );
    assert.equal(resumed.thread.id, id);
    await adapter.sessions!.deleteSession(root, id);
    assert.deepEqual(await adapter.sessions!.listProjectSessions(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
