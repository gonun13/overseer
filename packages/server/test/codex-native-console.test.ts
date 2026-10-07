import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import {
  AppServer,
  type ClientFactory,
} from "../../adapters/codex/src/app-server.js";
import { createCodexAdapter } from "@overseer/adapter-codex";
import { spawnPty, type PtyHandle } from "../src/pty.js";

// Not key-shaped on purpose, so push-time secret scanning has nothing to flag.
const OFFLINE_KEY = "offline-test-placeholder";

it("the pinned Codex TUI resumes the prepared thread with zero model tokens", async () => {
  assert.equal(process.env.OVERSEER_IN_CONTAINER, "1");
  const root = await mkdtemp(path.join(tmpdir(), "overseer-codex-tui-"));
  const home = path.join(root, "home");
  await mkdir(home);
  // Synthetic auth and a loopback-only provider; no credential from agent-home
  // is read, and no inference service can receive requests during this probe.
  const env = {
    ...process.env,
    CODEX_HOME: home,
    OPENAI_API_KEY: OFFLINE_KEY,
    TERM: "xterm-256color",
  };
  await writeFile(
    path.join(home, "config.toml"),
    `model="gpt-5.6-sol"
model_provider="test"
[model_providers.test]
name="Offline test"
env_key="OPENAI_API_KEY"
requires_openai_auth=false
base_url="http://127.0.0.1:1/v1"
wire_api="responses"
[projects."${root}"]
trust_level="trusted"
# The pinned catalog's newer-model notice, already answered.
[notice.model_migrations]
"gpt-5.6-sol" = "gpt-6-sol"
`,
  );
  // A cached newer release: only the adapter's launch flags keep the TUI's
  // update prompt away.
  await writeFile(
    path.join(home, "version.json"),
    JSON.stringify({
      latest_version: "999.0.0",
      last_checked_at: new Date().toISOString(),
    }),
  );
  await writeFile(
    path.join(home, "auth.json"),
    JSON.stringify({
      auth_mode: "apikey",
      OPENAI_API_KEY: OFFLINE_KEY,
    }),
  );
  const factory: ClientFactory = async (timeoutMs) => {
    const client = new AppServer({ timeoutMs, env });
    try {
      await client.initialize();
      return client;
    } catch (error) {
      await client.close();
      throw error;
    }
  };
  const adapter = createCodexAdapter(factory);
  let terminal: PtyHandle | undefined;
  let output = "";
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 10_000;
    while (!predicate()) {
      if (Date.now() > deadline)
        throw new Error(
          `Codex TUI did not reach the expected state:\n${plain().slice(-1500)}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const plain = () => output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  try {
    // The adapter's own preparation, so the TUI proves the thread resumable.
    const id = await adapter.sessions!.mintSessionId({ projectDir: root });
    const command = await adapter.consoleCommand!({
      cwd: root,
      sessionId: id,
      resume: true,
    });
    terminal = await spawnPty({ ...command, cols: 100, rows: 30, env });
    terminal.onData((data) => {
      output += data;
      if (data.includes("\x1b[6n")) terminal!.write("\x1b[1;1R");
    });
    // The status bar ends in the session title once the resume has loaded.
    await waitFor(() => /·\s*new session/.test(plain()));
    terminal.write("/status");
    // Let the command picker recognize the text before sending Enter.
    await new Promise((resolve) => setTimeout(resolve, 150));
    terminal.write("\r");
    await waitFor(() => plain().includes(id));
    assert.match(plain(), /Thread name:\s+new\s*session/);
    assert.match(plain(), /Token usage:\s+0\s*total/);
    // The container is the sandbox; Codex's own approval prompts still apply.
    assert.match(plain(), /danger-full-access,\s*Ask\s*for\s*approval/);
    // A trusted project defaults to workspace-write, which would start
    // bubblewrap; the adapter's launch must leave the container as the sandbox.
    assert.doesNotMatch(plain(), /bubblewrap|user namespaces/i);
    assert.doesNotMatch(plain(), /update available/i);
    // Launch flags that force the TUI off its shared background server
    // surface as a startup warning.
    assert.doesNotMatch(plain(), /\d+\s*warning/i);
  } finally {
    terminal?.kill();
    await terminal?.done;
    await rm(root, { recursive: true, force: true });
  }
});
