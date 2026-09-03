import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { createProjectCreator } from "../src/project-create.js";

const EMPTY_SCAN = async () => ({ projects: [], untracked: [] });

function baseDeps() {
  return {
    root: "/workspace",
    mkdir: mock.fn(async () => undefined),
    writeFile: mock.fn(async () => undefined),
    stat: mock.fn(async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }),
    rm: mock.fn(async () => undefined),
    scanWorkspace: mock.fn(EMPTY_SCAN),
    gitInit: mock.fn(async () => undefined),
    now: mock.fn(() => 1_000_000),
  };
}

describe("createProject", () => {
  it("creates the folder, inits git, and writes a README with a description", async () => {
    const deps = baseDeps();
    const createProject = createProjectCreator(deps);

    const result = await createProject({
      name: "My Cool Project",
      folder: "my-cool-project",
      description: "does cool things",
    });

    assert.deepEqual(result, { ok: true, path: "/workspace/my-cool-project" });
    assert.equal(deps.mkdir.mock.calls[0]?.arguments[0], "/workspace/my-cool-project");
    assert.equal(deps.gitInit.mock.calls[0]?.arguments[0], "/workspace/my-cool-project");
    assert.deepEqual(deps.writeFile.mock.calls[0]?.arguments, [
      "/workspace/my-cool-project/README.md",
      "# My Cool Project\n\ndoes cool things\n",
      "utf8",
    ]);
  });

  it("writes a README with no description paragraph when description is blank", async () => {
    const deps = baseDeps();
    const createProject = createProjectCreator(deps);

    await createProject({ name: "Bare", folder: "bare", description: "   " });

    assert.deepEqual(deps.writeFile.mock.calls[0]?.arguments, [
      "/workspace/bare/README.md",
      "# Bare\n",
      "utf8",
    ]);
  });

  it("rejects an empty name without touching the filesystem", async () => {
    const deps = baseDeps();
    const createProject = createProjectCreator(deps);

    const result = await createProject({
      name: "   ",
      folder: "whatever",
      description: "",
    });

    assert.deepEqual(result, {
      ok: false,
      benign: true,
      reason: "name cannot be empty",
    });
    assert.equal(deps.mkdir.mock.calls.length, 0);
  });

  for (const folder of [
    "Foo",
    "a b",
    "a/b",
    "../etc",
    ".git",
    "_overseer",
    "a_b",
    "",
  ]) {
    it(`rejects invalid folder ${JSON.stringify(folder)}`, async () => {
      const deps = baseDeps();
      const createProject = createProjectCreator(deps);

      const result = await createProject({
        name: "ok",
        folder,
        description: "",
      });

      assert.equal(result.ok, false);
      assert.equal((result as { benign: boolean }).benign, true);
      assert.equal(deps.mkdir.mock.calls.length, 0);
    });
  }

  it("rejects when the folder already exists, without mkdir/gitInit/writeFile", async () => {
    const deps = baseDeps();
    deps.stat = mock.fn(async () => ({}) as never);
    const createProject = createProjectCreator(deps);

    const result = await createProject({
      name: "ok",
      folder: "taken",
      description: "",
    });

    assert.deepEqual(result, {
      ok: false,
      benign: true,
      reason: "/workspace/taken already exists",
    });
    assert.equal(deps.mkdir.mock.calls.length, 0);
    assert.equal(deps.gitInit.mock.calls.length, 0);
    assert.equal(deps.writeFile.mock.calls.length, 0);
  });

  it("returns a non-benign error when mkdir throws, without cleanup", async () => {
    const deps = baseDeps();
    deps.mkdir = mock.fn(async () => {
      throw new Error("EACCES: permission denied");
    });
    const createProject = createProjectCreator(deps);

    const result = await createProject({
      name: "ok",
      folder: "ok",
      description: "",
    });

    assert.deepEqual(result, {
      ok: false,
      benign: false,
      reason: "EACCES: permission denied",
    });
    assert.equal(deps.rm.mock.calls.length, 0);
  });

  it("cleans up the folder when git init fails after mkdir succeeds", async () => {
    const deps = baseDeps();
    deps.gitInit = mock.fn(async () => {
      throw new Error("git not found");
    });
    const createProject = createProjectCreator(deps);

    const result = await createProject({
      name: "ok",
      folder: "ok",
      description: "",
    });

    assert.deepEqual(result, {
      ok: false,
      benign: false,
      reason: "git not found",
    });
    assert.equal(deps.rm.mock.calls[0]?.arguments[0], "/workspace/ok");
    assert.deepEqual(deps.rm.mock.calls[0]?.arguments[1], {
      recursive: true,
      force: true,
    });
  });

  it("cleans up the folder when the README write fails after git init succeeds", async () => {
    const deps = baseDeps();
    deps.writeFile = mock.fn(async () => {
      throw new Error("disk full");
    });
    const createProject = createProjectCreator(deps);

    const result = await createProject({
      name: "ok",
      folder: "ok",
      description: "",
    });

    assert.deepEqual(result, { ok: false, benign: false, reason: "disk full" });
    assert.equal(deps.rm.mock.calls[0]?.arguments[0], "/workspace/ok");
  });

  it("rejects a concurrent call while one is already in flight", async () => {
    const deps = baseDeps();
    let releaseMkdir: () => void = () => {};
    const mkdirGate = new Promise<void>((resolve) => {
      releaseMkdir = resolve;
    });
    deps.mkdir = mock.fn(async () => {
      await mkdirGate;
    });
    const createProject = createProjectCreator(deps);

    const first = createProject({ name: "a", folder: "a", description: "" });
    // Let the first call reach and block on mkdir before firing the second.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = await createProject({
      name: "b",
      folder: "b",
      description: "",
    });
    assert.deepEqual(second, {
      ok: false,
      benign: true,
      reason: "a project is already being created",
    });
    assert.equal(deps.mkdir.mock.calls.length, 1);

    releaseMkdir();
    const firstResult = await first;
    assert.equal(firstResult.ok, true);
  });

  it("rejects a call within the cooldown window of a prior success", async () => {
    const deps = baseDeps();
    let clock = 1_000_000;
    deps.now = mock.fn(() => clock);
    const createProject = createProjectCreator(deps);

    const first = await createProject({
      name: "a",
      folder: "a",
      description: "",
    });
    assert.equal(first.ok, true);

    clock += 500; // well under the cooldown
    const second = await createProject({
      name: "b",
      folder: "b",
      description: "",
    });
    assert.deepEqual(second, {
      ok: false,
      benign: true,
      reason: "creating projects too quickly — wait a moment",
    });
    assert.equal(deps.mkdir.mock.calls.length, 1);

    clock += 5_000; // past the cooldown
    const third = await createProject({
      name: "c",
      folder: "c",
      description: "",
    });
    assert.equal(third.ok, true);
  });

  it("rejects when the workspace already has the maximum number of projects", async () => {
    const deps = baseDeps();
    deps.scanWorkspace = mock.fn(async () => ({
      projects: Array.from({ length: 500 }, (_, i) => ({
        name: `p${i}`,
        path: `/workspace/p${i}`,
      })),
      untracked: [],
    }));
    const createProject = createProjectCreator(deps);

    const result = await createProject({
      name: "one-too-many",
      folder: "one-too-many",
      description: "",
    });

    assert.deepEqual(result, {
      ok: false,
      benign: true,
      reason: "workspace already has too many projects (500)",
    });
    assert.equal(deps.mkdir.mock.calls.length, 0);
  });
});
