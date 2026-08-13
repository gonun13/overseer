import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  readSnapshot,
  setTheme,
  themeForSnapshot,
  writeSnapshot,
} from "../src/memory/internal.js";

describe("theme in internal memory", () => {
  let previousDir: string | undefined;
  let dir: string;

  before(async () => {
    // Drain any in-process pending left by another file in the same runner.
    themeForSnapshot(undefined);
    previousDir = process.env.OVERSEER_INTERNAL_DIR;
    dir = await mkdtemp(path.join(tmpdir(), "overseer-theme-"));
    process.env.OVERSEER_INTERNAL_DIR = dir;
  });

  after(async () => {
    themeForSnapshot(undefined);
    if (previousDir === undefined) delete process.env.OVERSEER_INTERNAL_DIR;
    else process.env.OVERSEER_INTERNAL_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });

  it("holds a pre-discovery choice until the snapshot write", async () => {
    assert.equal(await readSnapshot(), undefined);

    const pending = await setTheme("machine");
    assert.equal(pending.ok, true);
    assert.equal(await readSnapshot(), undefined);

    const theme = themeForSnapshot(undefined);
    assert.equal(theme, "machine");
    assert.equal(themeForSnapshot(undefined), undefined);
  });

  it("persists into state.json once a snapshot exists", async () => {
    await writeSnapshot({
      runCount: 1,
      workspaceRoot: "/workspace",
      projects: [],
      adapters: [],
    });

    const written = await setTheme("machine");
    assert.equal(written.ok, true);

    const snapshot = await readSnapshot();
    assert.equal(snapshot?.theme, "machine");

    const again = await setTheme("samaritan");
    assert.equal(again.ok, true);
    assert.equal((await readSnapshot())?.theme, "samaritan");
  });

  it("prefers a pending mid-pass pick over the previous snapshot theme", async () => {
    await writeSnapshot({
      runCount: 2,
      workspaceRoot: "/workspace",
      projects: [],
      adapters: [],
      theme: "samaritan",
    });

    // Simulate discovery not having written yet while the operator toggles.
    process.env.OVERSEER_INTERNAL_DIR = path.join(dir, "empty-pass");
    await setTheme("machine");
    process.env.OVERSEER_INTERNAL_DIR = dir;

    const previous = await readSnapshot();
    assert.equal(previous?.theme, "samaritan");
    assert.equal(themeForSnapshot(previous), "machine");
  });
});
