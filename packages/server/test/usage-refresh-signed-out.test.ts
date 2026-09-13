import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { ServerMessage } from "@overseer/protocol";
import { readSnapshot, writeSnapshot } from "../src/memory/internal.js";
import {
  noteProviderSignedOut,
  startUsageRefresh,
} from "../src/usage-refresh.js";

/**
 * The repair path: auth lapses between refreshes, and whoever asks the CLI
 * next — the console, a session start, a usage check — is the one who finds
 * out. Before this, that finding stayed with the caller and the widget went on
 * showing the last good status, so the two surfaces disagreed out loud
 * ("signed in · usage currently not available" against "provider is not
 * signed in").
 */

let memoryDir: string;
let previousMemory: string | undefined;

before(async () => {
  memoryDir = await mkdtemp(path.join(tmpdir(), "overseer-usage-mem-"));
  previousMemory = process.env.OVERSEER_INTERNAL_DIR;
  process.env.OVERSEER_INTERNAL_DIR = memoryDir;
});

after(async () => {
  if (previousMemory === undefined) delete process.env.OVERSEER_INTERNAL_DIR;
  else process.env.OVERSEER_INTERNAL_DIR = previousMemory;
  await rm(memoryDir, { recursive: true, force: true });
});

async function seed(): Promise<void> {
  await writeSnapshot({
    runCount: 1,
    workspaceRoot: "/workspace",
    projects: [],
    providers: [
      {
        id: "claude-code",
        login: true,
        status: {
          authenticated: true,
          version: "2.1.226",
          usageState: "ready",
          usage: [{ id: "session", label: "session", used: 0.16 }],
        },
      },
    ],
  });
}

describe("noteProviderSignedOut", () => {
  it("writes the signed-out answer through and drops the stale gauges", async () => {
    await seed();
    const frames: ServerMessage[] = [];
    startUsageRefresh((message) => frames.push(message));

    await noteProviderSignedOut("claude-code", { authenticated: false });

    const snapshot = await readSnapshot();
    const status = snapshot?.providers.find((p) => p.id === "claude-code")
      ?.status;
    assert.equal(status?.authenticated, false);
    assert.equal(status?.usageState, undefined);
    assert.equal(status?.usage, undefined);

    const frame = frames.find((f) => f.type === "provider.status");
    assert.ok(frame, "the widget is told, not left to find out on its own");
  });

  it("leaves a signed-in answer alone — it decides nothing about usage", async () => {
    await seed();
    const frames: ServerMessage[] = [];
    startUsageRefresh((message) => frames.push(message));

    await noteProviderSignedOut("claude-code", { authenticated: true });

    const snapshot = await readSnapshot();
    const status = snapshot?.providers.find((p) => p.id === "claude-code")
      ?.status;
    assert.equal(status?.usageState, "ready");
    assert.equal(status?.usage?.length, 1);
    assert.equal(frames.length, 0);
  });
});
