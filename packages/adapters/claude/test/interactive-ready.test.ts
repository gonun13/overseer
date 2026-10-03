import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { ensureInteractiveReady } from "../src/interactive-ready.js";

let dir: string | undefined;
let previous: string | undefined;

afterEach(async () => {
  if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previous;
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function withTempConfig(): Promise<string> {
  previous = process.env.CLAUDE_CONFIG_DIR;
  dir = await mkdtemp(path.join(tmpdir(), "overseer-interactive-"));
  process.env.CLAUDE_CONFIG_DIR = dir;
  return dir;
}

describe("ensureInteractiveReady", () => {
  it("creates the config with onboarding complete", async () => {
    const root = await withTempConfig();
    await ensureInteractiveReady("/workspace/demo");
    const raw = await readFile(path.join(root, ".claude.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      hasCompletedOnboarding?: boolean;
      projects?: Record<string, { hasTrustDialogAccepted?: boolean }>;
    };
    assert.equal(parsed.hasCompletedOnboarding, true);
    assert.equal(
      parsed.projects?.["/workspace/demo"]?.hasTrustDialogAccepted,
      true,
    );
  });

  it("preserves unrelated fields and is idempotent", async () => {
    const root = await withTempConfig();
    await writeFile(
      path.join(root, ".claude.json"),
      JSON.stringify({
        hasCompletedOnboarding: false,
        theme: "dark",
        projects: {
          "/workspace/demo": { hasTrustDialogAccepted: false, other: 1 },
        },
      }),
      "utf8",
    );
    await ensureInteractiveReady("/workspace/demo");
    await ensureInteractiveReady("/workspace/demo");
    const parsed = JSON.parse(
      await readFile(path.join(root, ".claude.json"), "utf8"),
    ) as {
      hasCompletedOnboarding: boolean;
      theme: string;
      projects: Record<string, { hasTrustDialogAccepted: boolean; other?: number }>;
    };
    assert.equal(parsed.hasCompletedOnboarding, true);
    assert.equal(parsed.theme, "dark");
    assert.equal(parsed.projects["/workspace/demo"]?.other, 1);
    assert.equal(
      parsed.projects["/workspace/demo"]?.hasTrustDialogAccepted,
      true,
    );
  });
});
