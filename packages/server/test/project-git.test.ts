import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { createProjectGit } from "../src/project-git.js";

type Response = { stdout: string; stderr?: string } | Error;

/** A `run` fake that answers a script of responses in call order and records
 * every invocation's argv — the same shape `project-create.test.ts` uses for
 * its DI fakes, adapted for a sequence of git subcommands rather than one
 * filesystem call each. */
function scriptedRun(responses: Response[]) {
  let i = 0;
  const run = mock.fn(async (_dir: string, _args: string[]) => {
    const response = responses[i++];
    if (response === undefined) {
      throw new Error(`unexpected git call #${i}`);
    }
    if (response instanceof Error) throw response;
    return { stdout: response.stdout, stderr: response.stderr ?? "" };
  });
  return run;
}

describe("projectGit.status", () => {
  it("parses branch, ahead/behind, remote presence, and file statuses", async () => {
    const run = scriptedRun([
      {
        stdout:
          "## main...origin/main [ahead 1, behind 2]\n" +
          " M src/app.ts\n" +
          "A  src/new.ts\n" +
          " D old.ts\n" +
          "?? scratch.md\n" +
          "R  from.ts -> to.ts\n",
      },
      { stdout: "origin\n" },
    ]);
    const projectGit = createProjectGit({ run });

    const result = await projectGit.status("/workspace/demo");

    assert.deepEqual(result, {
      branch: "main",
      dirty: true,
      hasRemote: true,
      ahead: 1,
      behind: 2,
      files: [
        { path: "src/app.ts", status: "modified" },
        { path: "src/new.ts", status: "added" },
        { path: "old.ts", status: "deleted" },
        { path: "scratch.md", status: "untracked" },
        { path: "from.ts -> to.ts", status: "renamed" },
      ],
    });
  });

  it("reports a clean repo with no remote and no ahead/behind", async () => {
    const run = scriptedRun([{ stdout: "## main\n" }, { stdout: "" }]);
    const projectGit = createProjectGit({ run });

    const result = await projectGit.status("/workspace/demo");

    assert.deepEqual(result, {
      branch: "main",
      dirty: false,
      hasRemote: false,
      files: [],
    });
  });
});

describe("projectGit.commit", () => {
  it("refuses when there is nothing to commit, without running add/commit", async () => {
    const run = scriptedRun([{ stdout: "" }]);
    const projectGit = createProjectGit({ run });

    const result = await projectGit.commit("/workspace/demo", "message");

    assert.deepEqual(result, {
      ok: false,
      benign: true,
      reason: "nothing to commit",
    });
    assert.equal(run.mock.calls.length, 1);
  });

  it("commits without an identity override when git can already resolve one", async () => {
    const run = scriptedRun([
      { stdout: " M src/app.ts\n" }, // status --porcelain
      { stdout: "" }, // add -A
      { stdout: "Me <me@example.com> 1700000000 +0000\n" }, // var GIT_AUTHOR_IDENT
      { stdout: "" }, // commit
    ]);
    const projectGit = createProjectGit({ run });

    const result = await projectGit.commit("/workspace/demo", "fix things");

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(run.mock.calls[3]?.arguments[1], ["commit", "-m", "fix things"]);
    assert.equal(run.mock.calls[3]?.arguments[2], undefined);
  });

  it("falls back to the overseer identity — as env overrides, not -c config — when git cannot resolve one", async () => {
    // `git var GIT_AUTHOR_IDENT` is how this is detected rather than reading
    // `user.name`/`user.email` config directly: GIT_AUTHOR_NAME/EMAIL env
    // vars win over any config, and the compose files set those to empty
    // strings absent a host identity — a case `-c user.name=` cannot override
    // but replacing the env vars for this one call can.
    const run = scriptedRun([
      { stdout: " M src/app.ts\n" }, // status --porcelain
      { stdout: "" }, // add -A
      new Error("fatal: empty ident name (for <>) not allowed"), // var GIT_AUTHOR_IDENT
      { stdout: "" }, // commit
    ]);
    const projectGit = createProjectGit({ run });

    const result = await projectGit.commit("/workspace/demo", "fix things");

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(run.mock.calls[3]?.arguments[1], ["commit", "-m", "fix things"]);
    assert.deepEqual(run.mock.calls[3]?.arguments[2], {
      GIT_AUTHOR_NAME: "overseer",
      GIT_AUTHOR_EMAIL: "overseer@localhost",
      GIT_COMMITTER_NAME: "overseer",
      GIT_COMMITTER_EMAIL: "overseer@localhost",
    });
  });
});

describe("projectGit.push", () => {
  it("pushes the current branch with -u origin", async () => {
    const run = scriptedRun([
      { stdout: "## feature-x\n" }, // status --branch (for status())
      { stdout: "origin\n" }, // remote
      { stdout: "" }, // push
    ]);
    const projectGit = createProjectGit({ run });

    const result = await projectGit.push("/workspace/demo");

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(run.mock.calls[2]?.arguments[1], [
      "push",
      "-u",
      "origin",
      "feature-x",
    ]);
  });

  it("reports a benign failure when the push errors", async () => {
    const run = scriptedRun([
      { stdout: "## feature-x\n" },
      { stdout: "" },
      new Error("could not resolve host"),
    ]);
    const projectGit = createProjectGit({ run });

    const result = await projectGit.push("/workspace/demo");

    assert.equal(result.ok, false);
    assert.equal((result as { benign: boolean }).benign, true);
  });
});

describe("projectGit.mergeToMain", () => {
  it("refuses when a remote is attached", async () => {
    const run = scriptedRun([
      { stdout: "## feature-x\n" }, // status --branch
      { stdout: "origin\n" }, // remote
    ]);
    const projectGit = createProjectGit({ run });

    const result = await projectGit.mergeToMain("/workspace/demo");

    assert.deepEqual(result, {
      ok: false,
      benign: true,
      reason: "a remote is attached — merge through the upstream PR process",
    });
  });

  it("refuses when already on main", async () => {
    const run = scriptedRun([{ stdout: "## main\n" }, { stdout: "" }]);
    const projectGit = createProjectGit({ run });

    const result = await projectGit.mergeToMain("/workspace/demo");

    assert.deepEqual(result, {
      ok: false,
      benign: true,
      reason: "already on main",
    });
  });

  it("checks out main and merges the feature branch, with no identity override when one resolves", async () => {
    const run = scriptedRun([
      { stdout: "## feature-x\n" }, // status --branch
      { stdout: "" }, // remote
      { stdout: "" }, // checkout main
      { stdout: "Me <me@example.com> 1700000000 +0000\n" }, // var GIT_AUTHOR_IDENT
      { stdout: "" }, // merge --no-ff feature-x
    ]);
    const projectGit = createProjectGit({ run });

    const result = await projectGit.mergeToMain("/workspace/demo");

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(run.mock.calls[2]?.arguments[1], ["checkout", "main"]);
    assert.deepEqual(run.mock.calls[4]?.arguments[1], [
      "merge",
      "--no-ff",
      "feature-x",
    ]);
    assert.equal(run.mock.calls[4]?.arguments[2], undefined);
  });

  it("falls back to the overseer identity for the merge commit when git cannot resolve one", async () => {
    // --no-ff always makes a real merge commit, even for an otherwise
    // fast-forwardable merge — so it hits the same empty-ident-from-env
    // failure `commit` does, and needs the same override.
    const run = scriptedRun([
      { stdout: "## feature-x\n" }, // status --branch
      { stdout: "" }, // remote
      { stdout: "" }, // checkout main
      new Error("fatal: empty ident name (for <>) not allowed"), // var GIT_AUTHOR_IDENT
      { stdout: "" }, // merge --no-ff feature-x
    ]);
    const projectGit = createProjectGit({ run });

    const result = await projectGit.mergeToMain("/workspace/demo");

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(run.mock.calls[4]?.arguments[2], {
      GIT_AUTHOR_NAME: "overseer",
      GIT_AUTHOR_EMAIL: "overseer@localhost",
      GIT_COMMITTER_NAME: "overseer",
      GIT_COMMITTER_EMAIL: "overseer@localhost",
    });
  });

  it("aborts the merge and reports a benign conflict error", async () => {
    const run = scriptedRun([
      { stdout: "## feature-x\n" },
      { stdout: "" },
      { stdout: "" }, // checkout main
      { stdout: "Me <me@example.com> 1700000000 +0000\n" }, // var GIT_AUTHOR_IDENT
      new Error("CONFLICT (content): Merge conflict in src/app.ts"),
      { stdout: "" }, // merge --abort
    ]);
    const projectGit = createProjectGit({ run });

    const result = await projectGit.mergeToMain("/workspace/demo");

    assert.equal(result.ok, false);
    assert.equal((result as { benign: boolean }).benign, true);
    assert.deepEqual(run.mock.calls[5]?.arguments[1], ["merge", "--abort"]);
  });
});

describe("projectGit.revert", () => {
  it("resets and cleans the worktree", async () => {
    const run = scriptedRun([{ stdout: "" }, { stdout: "" }]);
    const projectGit = createProjectGit({ run });

    const result = await projectGit.revert("/workspace/demo");

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(run.mock.calls[0]?.arguments[1], [
      "reset",
      "--hard",
      "HEAD",
    ]);
    assert.deepEqual(run.mock.calls[1]?.arguments[1], ["clean", "-fd"]);
  });

  it("reports a benign refusal on an unborn branch with no HEAD", async () => {
    const run = scriptedRun([
      new Error("fatal: ambiguous argument 'HEAD': unknown revision"),
    ]);
    const projectGit = createProjectGit({ run });

    const result = await projectGit.revert("/workspace/demo");

    assert.equal(result.ok, false);
    assert.equal((result as { benign: boolean }).benign, true);
  });
});
