import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  readSnapshot,
  setProviderAuthenticated,
  writeSnapshot,
} from "../src/memory/internal.js";

/**
 * A login flips `authenticated` in the snapshot without re-asking the CLI for
 * its words. The detail it had was written for the other answer — keeping it
 * left a signed-in claude reading "not logged in" in the sign-in window.
 */

let memoryDir: string;
let previousMemory: string | undefined;

before(async () => {
  memoryDir = await mkdtemp(path.join(tmpdir(), "overseer-auth-detail-"));
  previousMemory = process.env.OVERSEER_INTERNAL_DIR;
  process.env.OVERSEER_INTERNAL_DIR = memoryDir;
});

after(async () => {
  if (previousMemory === undefined) delete process.env.OVERSEER_INTERNAL_DIR;
  else process.env.OVERSEER_INTERNAL_DIR = previousMemory;
  await rm(memoryDir, { recursive: true, force: true });
});

async function seed(authenticated: boolean, detail: string): Promise<void> {
  await writeSnapshot({
    runCount: 1,
    workspaceRoot: "/workspace",
    projects: [],
    providers: [
      {
        id: "claude",
        login: true,
        status: { authenticated, version: "2.1.308", detail },
      },
    ],
  });
}

async function claudeStatus() {
  const snapshot = await readSnapshot();
  return snapshot?.providers.find((p) => p.id === "claude")?.status;
}

describe("setProviderAuthenticated", () => {
  it("drops a detail written for the other answer", async () => {
    await seed(false, "not logged in");
    await setProviderAuthenticated("claude", true);

    const status = await claudeStatus();
    assert.equal(status?.authenticated, true);
    assert.equal(status?.detail, undefined);
    assert.equal(status?.version, "2.1.308");
  });

  it("keeps the detail when the answer does not change", async () => {
    await seed(true, "signed in · claude.ai");
    await setProviderAuthenticated("claude", true);

    const status = await claudeStatus();
    assert.equal(status?.detail, "signed in · claude.ai");
  });
});
