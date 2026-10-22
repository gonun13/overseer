import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { cliRunner } from "../src/cli.js";
import { createOpencodeAdapter } from "../src/index.js";
import { serveFactory } from "../src/serve.js";
import { dbPath } from "../src/sessions.js";

// Real pinned CLI, isolated state, no credentials and no model turns: what
// this adapter assumes about opencode's database and its serve API holds.
it("a prepared session lists, titles and deletes through the real CLI", async () => {
  assert.equal(
    process.env.OVERSEER_IN_CONTAINER,
    "1",
    "native probes run only in Docker",
  );
  const root = await mkdtemp(path.join(tmpdir(), "overseer-opencode-native-"));
  const project = path.join(root, "project");
  await mkdir(project);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_STATE_HOME: path.join(root, "state"),
    XDG_CACHE_HOME: path.join(root, "cache"),
  };
  try {
    const cli = cliRunner(env);
    const printed = await cli(["db", "path"], { timeoutMs: 30_000 });
    assert.equal(printed.stdout.trim(), dbPath(env));

    const adapter = createOpencodeAdapter({
      cli,
      serve: serveFactory(env),
      env,
    });
    const id = await adapter.sessions!.mintSessionId({ projectDir: project });
    assert.match(id, /^ses_/);
    const listed = await adapter.sessions!.listProjectSessions(project);
    assert.deepEqual(
      listed.map((s) => [s.id, s.name]),
      [[id, undefined]],
    );
    assert.equal(
      await adapter.sessions!.lookupSessionTitle(project, id),
      undefined,
    );
    await adapter.sessions!.deleteSession(project, id);
    assert.deepEqual(await adapter.sessions!.listProjectSessions(project), []);
    // Idempotent once gone.
    await adapter.sessions!.deleteSession(project, id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
