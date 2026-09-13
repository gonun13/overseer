import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GIT_MAX_PATH_CHARS, isClientMessage } from "@overseer/protocol";

/**
 * Guards for `project.git.list` — the frame that names a folder to list.
 *
 * Held to exactly the same contract as `project.git.show`'s `file`, and for
 * the same reason: `folder` reaches `git status` as a pathspec and the server
 * as a path to resolve, so a frame that cannot possibly name a directory
 * inside a project has to die here rather than downstream.
 *
 * The trailing-slash case is the one worth naming twice. Git prints a
 * collapsed untracked directory as `newdir/`, and that slash is an empty path
 * segment — the client strips it before building the frame, and this guard is
 * what makes sure nothing is relying on the server to be forgiving about it.
 */
describe("project.git.list guard", () => {
  const list = (folder: unknown) =>
    isClientMessage({ type: "project.git.list", path: "/workspace/demo", folder });

  it("accepts an ordinary repo-relative folder", () => {
    assert.equal(list("newdir"), true);
    assert.equal(list("src/vcs"), true);
    assert.equal(list("docs/samples/deep"), true);
  });

  it("accepts folder names with characters a shell would care about", () => {
    // No shell is involved — git is spawned with an argv array — so these are
    // ordinary directory names.
    assert.equal(list("a folder with spaces"), true);
    assert.equal(list("$weird;name&"), true);
    assert.equal(list("café"), true);
  });

  it("rejects the trailing slash git prints on a collapsed directory", () => {
    assert.equal(list("newdir/"), false);
    assert.equal(list("src//vcs"), false);
  });

  it("rejects an escape out of the project", () => {
    assert.equal(list("../../etc"), false);
    assert.equal(list("a/../../b"), false);
    assert.equal(list(".."), false);
  });

  it("rejects a backslash escape", () => {
    assert.equal(list("..\\..\\x"), false);
    assert.equal(list("src\\vcs"), false);
  });

  it("rejects an absolute path", () => {
    assert.equal(list("/etc"), false);
    assert.equal(list("/workspace/demo/src"), false);
  });

  it("rejects a leading dash, which git could read as a flag", () => {
    assert.equal(list("-p"), false);
    assert.equal(list("--output=/tmp/x"), false);
  });

  it("rejects an empty, non-string, or NUL-bearing folder", () => {
    assert.equal(list(""), false);
    assert.equal(list(undefined), false);
    assert.equal(list(42), false);
    assert.equal(list("src\0/vcs"), false);
  });

  it("rejects a folder past the path cap", () => {
    assert.equal(list("a".repeat(GIT_MAX_PATH_CHARS)), true);
    assert.equal(list("a".repeat(GIT_MAX_PATH_CHARS + 1)), false);
  });

  it("rejects a missing project path", () => {
    assert.equal(
      isClientMessage({ type: "project.git.list", folder: "newdir" }),
      false,
    );
  });
});
