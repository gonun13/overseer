import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  clearInternalMemory,
  internalMemoryRoot,
  readActions,
  readSnapshot,
  recordAction,
  writeRunLog,
  writeSnapshot,
} from "../src/memory/internal.js";
import { deletePersonalityConfig } from "../src/memory/personality/api.js";
import {
  personalityConfigPath,
  personalityDir,
} from "../src/memory/personality/scaffold.js";

async function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}

describe("reset overseer", () => {
  let previousDir: string | undefined;
  let dir: string;

  before(async () => {
    previousDir = process.env.OVERSEER_INTERNAL_DIR;
    dir = await mkdtemp(path.join(tmpdir(), "overseer-reset-"));
    process.env.OVERSEER_INTERNAL_DIR = dir;
  });

  after(async () => {
    if (previousDir === undefined) delete process.env.OVERSEER_INTERNAL_DIR;
    else process.env.OVERSEER_INTERNAL_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });

  it("erases the snapshot, the register and every run log", async () => {
    await writeSnapshot({
      runCount: 3,
      workspaceRoot: "/workspace",
      projects: [],
      providers: [],
      theme: "machine",
    });
    await recordAction({
      actor: "operator",
      action: "theme:select",
      outcome: "ok",
    });
    await writeRunLog("a-run", [{ type: "discovery.start" }]);

    assert.notEqual(await readSnapshot(), undefined);
    assert.equal((await readActions()).length, 1);
    assert.equal((await readdir(path.join(dir, "logs"))).length, 1);

    await clearInternalMemory();

    // Nothing is left to remember, and "returning" is derived from the
    // snapshot's existence — so the next boot is a first run.
    assert.equal(await readSnapshot(), undefined);
    assert.deepEqual(await readActions(), []);
    assert.deepEqual(await readdir(path.join(dir, "logs")), []);
  });

  it("erases the lines the wipe itself writes", async () => {
    // `deletePersonalityConfig` records itself, and it runs before the register
    // is cleared — so an action written mid-wipe must not survive as the next
    // instance's first memory.
    await recordAction({
      actor: "operator",
      action: "personality:delete",
      outcome: "ok",
    });

    await clearInternalMemory();

    assert.deepEqual(await readActions(), []);
  });

  it("leaves internal memory writable for the run that follows", async () => {
    await clearInternalMemory();

    // The wipe removes the directories `ensureDirs` memoised, so this is the
    // case where a stale memo would silently drop the new run's records.
    await recordAction({
      actor: "overseer",
      action: "discovery:start",
      outcome: "ok",
    });
    await writeSnapshot({
      runCount: 1,
      workspaceRoot: "/workspace",
      projects: [],
      providers: [],
    });

    assert.equal((await readActions()).length, 1);
    assert.equal((await readSnapshot())?.runCount, 1);
    assert.equal(internalMemoryRoot(), dir);
  });
});

describe("deletePersonalityConfig", () => {
  let previousDir: string | undefined;
  let internal: string;
  let workspace: string;

  before(async () => {
    previousDir = process.env.OVERSEER_INTERNAL_DIR;
    internal = await mkdtemp(path.join(tmpdir(), "overseer-reset-internal-"));
    process.env.OVERSEER_INTERNAL_DIR = internal;
    workspace = await mkdtemp(path.join(tmpdir(), "overseer-reset-workspace-"));
  });

  after(async () => {
    if (previousDir === undefined) delete process.env.OVERSEER_INTERNAL_DIR;
    else process.env.OVERSEER_INTERNAL_DIR = previousDir;
    await rm(internal, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });

  it("removes the config and nothing else in the project", async () => {
    const dir = personalityDir(workspace);
    await mkdir(path.join(dir, ".git"), { recursive: true });
    await writeFile(
      personalityConfigPath(workspace),
      '{"tone":"dry"}\n',
      "utf8",
    );
    await writeFile(path.join(dir, "README.md"), "# personality\n", "utf8");

    const result = await deletePersonalityConfig(workspace);

    assert.equal(result.ok, true);
    assert.equal(await exists(personalityConfigPath(workspace)), false);
    // The project is the operator's own git repo; a reset forgets what the
    // overseer was told, it does not remove a repository.
    assert.equal(await exists(path.join(dir, "README.md")), true);
    assert.equal(await exists(path.join(dir, ".git")), true);
  });

  it("is fine with a config that is already gone", async () => {
    const result = await deletePersonalityConfig(workspace);
    assert.equal(result.ok, true);
  });

  it("records the delete in the register", async () => {
    const actions = await readActions();
    assert.equal(
      actions.some((entry) => entry.action === "personality:delete"),
      true,
    );
  });
});
