import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GIT_MAX_PATH_CHARS, isClientMessage } from "@overseer/protocol";

/**
 * Guards for `project.git.show` — the frame that names a file to read.
 *
 * These live in the server's suite for the same reason the git-access guards
 * do: `protocol` ships types and pure functions with no harness of its own.
 *
 * The reject cases are the security contract, not hypotheticals. `path` names
 * a project directory the server checks for workspace containment; `file` is
 * the second, separately-attackable half, and it reaches `git diff` as a
 * pathspec and the filesystem as a read. A frame that cannot possibly name a
 * file inside a project has to die here, before the code that would otherwise
 * have to prove it does not.
 */
describe("project.git.show guard", () => {
  const show = (file: unknown, mode: unknown = "diff", previousPath?: unknown) => {
    const frame: Record<string, unknown> = {
      type: "project.git.show",
      path: "/workspace/demo",
      file,
      mode,
    };
    if (previousPath !== undefined) frame.previousPath = previousPath;
    return isClientMessage(frame);
  };

  it("accepts an ordinary repo-relative file, in both modes", () => {
    assert.equal(show("src/vcs/ops.ts"), true);
    assert.equal(show("src/vcs/ops.ts", "content"), true);
    assert.equal(show("README.md"), true);
  });

  it("accepts a renamed file's previous name alongside it", () => {
    assert.equal(show("to.ts", "diff", "from.ts"), true);
  });

  it("accepts paths with characters a shell would care about", () => {
    // No shell is involved — git is spawned with an argv array — so these are
    // ordinary filenames, and refusing them would be the guard inventing a
    // restriction the filesystem does not have.
    assert.equal(show("src/a file with spaces.ts"), true);
    assert.equal(show("src/$weird;name&.ts"), true);
    assert.equal(show("docs/café.md"), true);
  });

  it("rejects an escape out of the project", () => {
    assert.equal(show("../../etc/passwd"), false);
    assert.equal(show("a/../../b"), false);
    assert.equal(show(".."), false);
    assert.equal(show("../x"), false);
  });

  it("rejects a backslash escape", () => {
    // Git pathspecs are `/`-separated everywhere, so a backslash is never
    // load-bearing — and `..\` is the same escape wearing a different
    // separator.
    assert.equal(show("..\\..\\x"), false);
    assert.equal(show("src\\ops.ts"), false);
  });

  it("rejects an absolute path", () => {
    assert.equal(show("/etc/passwd"), false);
    assert.equal(show("/workspace/demo/src/ops.ts"), false);
  });

  it("rejects a leading dash, which git could read as a flag", () => {
    assert.equal(show("-p"), false);
    assert.equal(show("--output=/tmp/x"), false);
  });

  it("rejects an empty, non-string, or NUL-bearing file", () => {
    assert.equal(show(""), false);
    assert.equal(show(undefined), false);
    assert.equal(show(42), false);
    assert.equal(show("src/ops.ts\0.png"), false);
  });

  it("rejects an empty path segment", () => {
    assert.equal(show("src//ops.ts"), false);
    assert.equal(show("src/"), false);
  });

  it("rejects a file past the path cap", () => {
    assert.equal(show("a".repeat(GIT_MAX_PATH_CHARS)), true);
    assert.equal(show("a".repeat(GIT_MAX_PATH_CHARS + 1)), false);
  });

  it("rejects a missing or unknown mode", () => {
    // Built by hand rather than through `show`, whose default parameter would
    // fill an omitted mode back in and quietly test nothing.
    assert.equal(
      isClientMessage({
        type: "project.git.show",
        path: "/workspace/demo",
        file: "src/ops.ts",
      }),
      false,
    );
    assert.equal(show("src/ops.ts", "raw"), false);
    assert.equal(show("src/ops.ts", ""), false);
  });

  it("rejects a previousPath that is present but invalid", () => {
    // Present-and-bad is the case worth naming: `previousPath` is optional, so
    // the guard must not treat "supplied" as "already trusted".
    assert.equal(show("to.ts", "diff", "../../etc/passwd"), false);
    assert.equal(show("to.ts", "diff", ""), false);
    assert.equal(show("to.ts", "diff", 42), false);
  });

  it("rejects a missing project path", () => {
    assert.equal(
      isClientMessage({ type: "project.git.show", file: "a.ts", mode: "diff" }),
      false,
    );
  });
});
