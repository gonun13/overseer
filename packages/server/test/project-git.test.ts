import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { createProjectGit } from "../src/vcs/ops.js";

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

/** No identity configured in settings — the default for every test that is
 * not specifically about the operator's own identity. Injected rather than
 * left to the real reader so the suite never touches internal memory. */
const noIdentity = async () => undefined;

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
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

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
        { path: "to.ts", previousPath: "from.ts", status: "renamed" },
      ],
    });
  });

  it("keeps an arrow that is part of a filename out of the rename split", async () => {
    // ` -> ` is a separator only on a rename line. On any other status it is
    // just characters in a name, and splitting there would report a file that
    // does not exist.
    const run = scriptedRun([
      { stdout: "## main\n" + " M src/a -> b.ts\n" + "R  old -> x.ts -> new.ts\n" },
      { stdout: "" },
    ]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.status("/workspace/demo");

    assert.deepEqual(result.files, [
      { path: "src/a -> b.ts", status: "modified" },
      // Split on the *last* separator: the old name is the one that may itself
      // contain an arrow.
      { path: "new.ts", previousPath: "old -> x.ts", status: "renamed" },
    ]);
  });

  it("reports a clean repo with no remote and no ahead/behind", async () => {
    const run = scriptedRun([{ stdout: "## main\n" }, { stdout: "" }]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

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
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

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
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

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
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

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

  it("prefers the operator's configured identity over the repository's own", async () => {
    // The third branch, and the reason the other two are not enough: an
    // identity set in settings has to beat both the repo config *and* the
    // empty GIT_AUTHOR_* the compose files pass in, so it is applied
    // unconditionally and `git var` is never consulted.
    const run = scriptedRun([
      { stdout: " M src/app.ts\n" }, // status --porcelain
      { stdout: "" }, // add -A
      { stdout: "" }, // commit
    ]);
    const projectGit = createProjectGit({
      run,
      readIdentity: async () => ({ name: "Nuno", email: "ada@example.com" }),
    });

    const result = await projectGit.commit("/workspace/demo", "fix things");

    assert.deepEqual(result, { ok: true });
    // No `git var GIT_AUTHOR_IDENT` probe: there is nothing it could change.
    assert.deepEqual(run.mock.calls[2]?.arguments[1], ["commit", "-m", "fix things"]);
    assert.deepEqual(run.mock.calls[2]?.arguments[2], {
      GIT_AUTHOR_NAME: "Nuno",
      GIT_AUTHOR_EMAIL: "ada@example.com",
      GIT_COMMITTER_NAME: "Nuno",
      GIT_COMMITTER_EMAIL: "ada@example.com",
    });
  });
});

describe("projectGit.push failure messages", () => {
  const pushFailing = (stderr: string, origin = "git@github.com:o/r.git") => {
    const responses: Response[] = [
      { stdout: "## main...origin/main\n" }, // status --porcelain --branch
      { stdout: "origin\n" }, // remote
      Object.assign(new Error("Command failed"), { stderr }), // push
      { stdout: `${origin}\n` }, // remote get-url origin
    ];
    const run = scriptedRun(responses);
    return createProjectGit({ run, readIdentity: noIdentity });
  };

  it("points a refused key at the settings panel that makes one", async () => {
    const result = await pushFailing(
      "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n",
    ).push("/workspace/demo");

    assert.equal(result.ok, false);
    assert.match(
      (result as { reason: string }).reason,
      /no ssh key is set up for this remote — add one in settings/,
    );
  });

  it("says an https remote cannot use the key at all", async () => {
    // Otherwise the most confusing possible outcome: the key is set up
    // correctly and simply is not consulted.
    const result = await pushFailing(
      "fatal: Could not read from remote repository.\n",
      "https://github.com/o/r.git",
    ).push("/workspace/demo");

    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /uses https/);
  });

  it("names a changed host key", async () => {
    const result = await pushFailing(
      "@@@ WARNING @@@\nHost key verification failed.\n",
    ).push("/workspace/demo");

    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /host key changed/);
  });

  it("passes an unrelated failure through untouched", async () => {
    const result = await pushFailing(
      "error: failed to push some refs\n",
    ).push("/workspace/demo");

    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /failed to push some refs/);
    assert.doesNotMatch((result as { reason: string }).reason, /settings/);
  });
});

describe("projectGit.push", () => {
  it("pushes the current branch with -u origin", async () => {
    const run = scriptedRun([
      { stdout: "## feature-x\n" }, // status --branch (for status())
      { stdout: "origin\n" }, // remote
      { stdout: "" }, // push
    ]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

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
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.push("/workspace/demo");

    assert.equal(result.ok, false);
    assert.equal((result as { benign: boolean }).benign, true);
  });
});

describe("projectGit.defaultBranch", () => {
  it("resolves to the remote's own default when origin/HEAD is recorded locally", async () => {
    const run = scriptedRun([
      { stdout: "refs/remotes/origin/trunk\n" }, // symbolic-ref origin/HEAD
    ]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.defaultBranch("/workspace/demo");

    assert.equal(result, "trunk");
    assert.equal(run.mock.calls.length, 1);
  });

  it("falls back to main when no remote default is recorded but main exists locally", async () => {
    const run = scriptedRun([
      new Error("fatal: ref refs/remotes/origin/HEAD is not a symbolic ref"),
      { stdout: "develop\nmain\n" }, // branch --format
    ]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.defaultBranch("/workspace/demo");

    assert.equal(result, "main");
  });

  it("falls back to master when main is absent", async () => {
    const run = scriptedRun([
      new Error("fatal: ref refs/remotes/origin/HEAD is not a symbolic ref"),
      { stdout: "develop\nmaster\n" },
    ]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.defaultBranch("/workspace/demo");

    assert.equal(result, "master");
  });

  it("falls back to the current branch when neither convention nor a remote default exists", async () => {
    const run = scriptedRun([
      new Error("fatal: ref refs/remotes/origin/HEAD is not a symbolic ref"),
      { stdout: "develop\nfeature-x\n" },
      { stdout: "feature-x\n" }, // branch --show-current
    ]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.defaultBranch("/workspace/demo");

    assert.equal(result, "feature-x");
  });
});

describe("projectGit.mergeToDefault", () => {
  it("refuses when a remote is attached", async () => {
    const run = scriptedRun([
      { stdout: "## feature-x\n" }, // status --branch
      { stdout: "origin\n" }, // remote
    ]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.mergeToDefault("/workspace/demo");

    assert.deepEqual(result, {
      ok: false,
      benign: true,
      reason: "a remote is attached — merge through the upstream PR process",
    });
  });

  it("refuses when already on the default branch", async () => {
    const run = scriptedRun([
      { stdout: "## main\n" }, // status --branch
      { stdout: "" }, // remote
      new Error("fatal: ref refs/remotes/origin/HEAD is not a symbolic ref"),
      { stdout: "main\n" }, // branch --format
    ]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.mergeToDefault("/workspace/demo");

    assert.deepEqual(result, {
      ok: false,
      benign: true,
      reason: "already on main",
    });
  });

  it("checks out the default branch and merges the feature branch, with no identity override when one resolves", async () => {
    const run = scriptedRun([
      { stdout: "## feature-x\n" }, // status --branch
      { stdout: "" }, // remote
      new Error("fatal: ref refs/remotes/origin/HEAD is not a symbolic ref"),
      { stdout: "feature-x\nmain\n" }, // branch --format
      { stdout: "" }, // checkout main
      { stdout: "Me <me@example.com> 1700000000 +0000\n" }, // var GIT_AUTHOR_IDENT
      { stdout: "" }, // merge --no-ff feature-x
    ]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.mergeToDefault("/workspace/demo");

    assert.deepEqual(result, { ok: true, from: "feature-x", into: "main" });
    assert.deepEqual(run.mock.calls[4]?.arguments[1], ["checkout", "main"]);
    assert.deepEqual(run.mock.calls[6]?.arguments[1], [
      "merge",
      "--no-ff",
      "feature-x",
    ]);
    assert.equal(run.mock.calls[6]?.arguments[2], undefined);
  });

  it("targets master instead of main when that's the project's default", async () => {
    const run = scriptedRun([
      { stdout: "## feature-x\n" }, // status --branch
      { stdout: "" }, // remote
      new Error("fatal: ref refs/remotes/origin/HEAD is not a symbolic ref"),
      { stdout: "feature-x\nmaster\n" }, // branch --format — no `main`
      { stdout: "" }, // checkout master
      { stdout: "Me <me@example.com> 1700000000 +0000\n" }, // var GIT_AUTHOR_IDENT
      { stdout: "" }, // merge --no-ff feature-x
    ]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.mergeToDefault("/workspace/demo");

    assert.deepEqual(result, { ok: true, from: "feature-x", into: "master" });
    assert.deepEqual(run.mock.calls[4]?.arguments[1], ["checkout", "master"]);
  });

  it("falls back to the overseer identity for the merge commit when git cannot resolve one", async () => {
    // --no-ff always makes a real merge commit, even for an otherwise
    // fast-forwardable merge — so it hits the same empty-ident-from-env
    // failure `commit` does, and needs the same override.
    const run = scriptedRun([
      { stdout: "## feature-x\n" }, // status --branch
      { stdout: "" }, // remote
      new Error("fatal: ref refs/remotes/origin/HEAD is not a symbolic ref"),
      { stdout: "feature-x\nmain\n" }, // branch --format
      { stdout: "" }, // checkout main
      new Error("fatal: empty ident name (for <>) not allowed"), // var GIT_AUTHOR_IDENT
      { stdout: "" }, // merge --no-ff feature-x
    ]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.mergeToDefault("/workspace/demo");

    assert.deepEqual(result, { ok: true, from: "feature-x", into: "main" });
    assert.deepEqual(run.mock.calls[6]?.arguments[2], {
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
      new Error("fatal: ref refs/remotes/origin/HEAD is not a symbolic ref"),
      { stdout: "feature-x\nmain\n" }, // branch --format
      { stdout: "" }, // checkout main
      { stdout: "Me <me@example.com> 1700000000 +0000\n" }, // var GIT_AUTHOR_IDENT
      new Error("CONFLICT (content): Merge conflict in src/app.ts"),
      { stdout: "" }, // merge --abort
    ]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.mergeToDefault("/workspace/demo");

    assert.equal(result.ok, false);
    assert.equal((result as { benign: boolean }).benign, true);
    assert.deepEqual(run.mock.calls[7]?.arguments[1], ["merge", "--abort"]);
  });
});

describe("projectGit.revert", () => {
  it("resets and cleans the worktree", async () => {
    const run = scriptedRun([{ stdout: "" }, { stdout: "" }]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

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
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.revert("/workspace/demo");

    assert.equal(result.ok, false);
    assert.equal((result as { benign: boolean }).benign, true);
  });
});

describe("projectGit.diffFile", () => {
  const DIFF =
    "diff --git a/src/app.ts b/src/app.ts\n" +
    "index 1111111..2222222 100644\n" +
    "--- a/src/app.ts\n" +
    "+++ b/src/app.ts\n" +
    "@@ -1,3 +1,3 @@\n" +
    " context\n" +
    "-gone\n" +
    "+added\n";

  /** Every diff read probes for a commit first, so the scripts here lead with
   * that call's answer. A non-empty stdout means `HEAD` resolved. */
  const headExists = { stdout: "abc123\n" };

  it("diffs the file against HEAD, with the hardening flags", async () => {
    const run = scriptedRun([headExists, { stdout: DIFF }]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.diffFile("/workspace/demo", "src/app.ts");

    assert.deepEqual(result, { ok: true, text: DIFF, truncated: false });
    const argv = run.mock.calls[1]?.arguments[1] ?? [];
    assert.deepEqual(argv.slice(-3), ["HEAD", "--", "src/app.ts"]);
    // A repo's own config must not get to choose what this spawns.
    for (const flag of ["--no-ext-diff", "--no-textconv", "--no-color"]) {
      assert.ok(argv.includes(flag), `expected ${flag} in ${argv.join(" ")}`);
    }
  });

  it("names both sides of a rename so git reports it as one", async () => {
    const run = scriptedRun([headExists, { stdout: DIFF }]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    await projectGit.diffFile("/workspace/demo", "to.ts", "from.ts");

    const argv = run.mock.calls[1]?.arguments[1] ?? [];
    assert.deepEqual(argv.slice(-4), ["HEAD", "--", "from.ts", "to.ts"]);
    assert.ok(argv.includes("-M"));
  });

  it("falls back to a --no-index diff for an untracked file", async () => {
    // The revision diff returns nothing for a path git has never seen, and the
    // fallback exits 1 to mean "they differ" — a normal answer that `execFile`
    // reports as a rejection, with the diff still on the error.
    const noIndex = "diff --git a/scratch.md b/scratch.md\n+++ b/scratch.md\n+new\n";
    const run = scriptedRun([
      headExists,
      { stdout: "" },
      Object.assign(new Error("Command failed: exit 1"), { stdout: noIndex }),
    ]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.diffFile("/workspace/demo", "scratch.md");

    assert.deepEqual(result, { ok: true, text: noIndex, truncated: false });
    const argv = run.mock.calls[2]?.arguments[1] ?? [];
    assert.ok(argv.includes("--no-index"));
    assert.deepEqual(argv.slice(-3), ["--", "/dev/null", "scratch.md"]);
  });

  it("still fails when the fallback produced no diff at all", async () => {
    const run = scriptedRun([
      headExists,
      { stdout: "" },
      Object.assign(new Error("boom"), { stderr: "fatal: unreadable\n" }),
    ]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.diffFile("/workspace/demo", "scratch.md");

    assert.deepEqual(result, {
      ok: false,
      benign: true,
      reason: "fatal: unreadable",
    });
  });

  it("diffs against the empty tree in a repo with no commits", async () => {
    const run = scriptedRun([new Error("fatal: bad revision"), { stdout: DIFF }]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.diffFile("/workspace/demo", "src/app.ts");

    assert.equal(result.ok, true);
    const argv = run.mock.calls[1]?.arguments[1] ?? [];
    assert.ok(argv.includes("4b825dc642cb6eb9a060e54bf8d69288fbee4904"));
    assert.ok(!argv.includes("HEAD"));
  });

  it("passes a binary verdict through as the text it is", async () => {
    const binary = "Binary files a/logo.png and b/logo.png differ\n";
    const run = scriptedRun([headExists, { stdout: binary }]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.diffFile("/workspace/demo", "logo.png");

    assert.deepEqual(result, { ok: true, text: binary, truncated: false });
  });

  it("clips an oversized diff and says that it did", async () => {
    const huge = Array.from({ length: 2_050 }, (_, n) => `+line ${n}`).join("\n");
    const run = scriptedRun([headExists, { stdout: huge }]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.diffFile("/workspace/demo", "big.txt");

    assert.equal(result.ok, true);
    const shown = result as { text: string; truncated: boolean };
    assert.equal(shown.truncated, true);
    assert.equal(shown.text.split("\n").length, 2_000);
  });

  it("reports a git failure as a benign refusal", async () => {
    const run = scriptedRun([
      headExists,
      Object.assign(new Error("boom"), {
        stderr: "fatal: path 'nope.ts' does not exist\nsecond line\n",
      }),
    ]);
    const projectGit = createProjectGit({ run, readIdentity: noIdentity });

    const result = await projectGit.diffFile("/workspace/demo", "nope.ts");

    assert.deepEqual(result, {
      ok: false,
      benign: true,
      reason: "fatal: path 'nope.ts' does not exist",
    });
  });
});

describe("projectGit.readFile", () => {
  const never = async () => {
    throw new Error("git should not be spawned to read a working-tree file");
  };

  it("reads the file from the worktree, resolved against the project", async () => {
    const seen: string[] = [];
    const projectGit = createProjectGit({
      run: never,
      readIdentity: noIdentity,
      readFile: async (absolute) => {
        seen.push(absolute);
        return Buffer.from("hello\nworld\n", "utf8");
      },
    });

    const result = await projectGit.readFile("/workspace/demo", "src/app.ts");

    assert.deepEqual(result, { ok: true, text: "hello\nworld\n", truncated: false });
    assert.deepEqual(seen, ["/workspace/demo/src/app.ts"]);
  });

  it("refuses a binary file rather than rendering replacement characters", async () => {
    const projectGit = createProjectGit({
      run: never,
      readIdentity: noIdentity,
      readFile: async () => Buffer.from([0x89, 0x50, 0x00, 0x4e, 0x47]),
    });

    const result = await projectGit.readFile("/workspace/demo", "logo.png");

    assert.deepEqual(result, { ok: false, benign: true, reason: "binary file" });
  });

  it("clips an oversized file", async () => {
    const projectGit = createProjectGit({
      run: never,
      readIdentity: noIdentity,
      readFile: async () =>
        Buffer.from(Array.from({ length: 2_050 }, (_, n) => `line ${n}`).join("\n")),
    });

    const result = await projectGit.readFile("/workspace/demo", "big.txt");

    assert.equal((result as { truncated: boolean }).truncated, true);
  });

  it("reports an unreadable file as a benign refusal", async () => {
    const projectGit = createProjectGit({
      run: never,
      readIdentity: noIdentity,
      readFile: async () => {
        throw new Error("ENOENT: no such file or directory");
      },
    });

    const result = await projectGit.readFile("/workspace/demo", "gone.ts");

    assert.equal(result.ok, false);
    assert.equal((result as { benign: boolean }).benign, true);
  });
});
