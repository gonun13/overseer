import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  clearPendingOperatorChoices,
  readSnapshot,
  setGitIdentity,
  setTheme,
  writeSnapshot,
} from "../src/memory/internal.js";

/** A discovery-shaped snapshot write: the world it observed, and nothing the
 * operator owns — those the write carries forward itself. */
const world = (runCount: number) => ({
  runCount,
  workspaceRoot: "/workspace",
  projects: [],
  providers: [],
});

describe("operator choices in internal memory", () => {
  let previousDir: string | undefined;
  let dir: string;

  before(async () => {
    // Drain any in-process pending left by another file in the same runner.
    clearPendingOperatorChoices();
    previousDir = process.env.OVERSEER_INTERNAL_DIR;
    dir = await mkdtemp(path.join(tmpdir(), "overseer-theme-"));
    process.env.OVERSEER_INTERNAL_DIR = dir;
  });

  after(async () => {
    clearPendingOperatorChoices();
    if (previousDir === undefined) delete process.env.OVERSEER_INTERNAL_DIR;
    else process.env.OVERSEER_INTERNAL_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });

  it("holds a pre-discovery choice until the snapshot write", async () => {
    assert.equal(await readSnapshot(), undefined);

    const pending = await setTheme("machine");
    assert.equal(pending.ok, true);
    assert.equal(await readSnapshot(), undefined);

    await writeSnapshot(world(1));
    assert.equal((await readSnapshot())?.theme, "machine");
  });

  it("persists into state.json once a snapshot exists", async () => {
    const written = await setTheme("machine");
    assert.equal(written.ok, true);

    const snapshot = await readSnapshot();
    assert.equal(snapshot?.theme, "machine");

    const again = await setTheme("samaritan");
    assert.equal(again.ok, true);
    assert.equal((await readSnapshot())?.theme, "samaritan");
  });

  it("keeps a choice made while a discovery pass was already running", async () => {
    // The regression this exists for: a pass reads the snapshot when it starts
    // and writes at the end. Everything the operator set in between used to be
    // overwritten by the copy the pass was holding, so an identity typed into
    // settings during a pass vanished and had to be typed in again.
    await writeSnapshot(world(2));
    await setTheme("samaritan");

    // Mid-pass: both land in state.json ahead of the pass's own write.
    await setGitIdentity("Ada", "ada@example.com");
    await setTheme("machine");

    // The pass ends, writing the world it observed before either call.
    await writeSnapshot(world(3));

    const snapshot = await readSnapshot();
    assert.equal(snapshot?.runCount, 3);
    assert.equal(snapshot?.theme, "machine");
    assert.deepEqual(snapshot?.git_identity, {
      name: "Ada",
      email: "ada@example.com",
    });
  });

  it("carries an identity across a pass that observed no change", async () => {
    await setGitIdentity("Ada", "ada@example.com");
    await writeSnapshot(world(4));
    await writeSnapshot(world(5));

    assert.deepEqual((await readSnapshot())?.git_identity, {
      name: "Ada",
      email: "ada@example.com",
    });
  });
});
