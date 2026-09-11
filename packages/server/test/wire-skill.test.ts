import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SKILL_MAX_UPLOAD_FILES,
  SKILL_MAX_UPLOAD_FILE_CHARS,
  SKILL_MAX_UPLOAD_TOTAL_CHARS,
  isClientMessage,
} from "@overseer/protocol";

/**
 * The socket is a trust boundary, and `skill.import` is the frame that ends in
 * a directory tree being written from data the operator supplied — a url the
 * server will clone, or file paths it will join. Lives in the server's suite
 * for the same reason `wire-subagent.test.ts` does.
 */

function importMsg(over: Record<string, unknown> = {}): unknown {
  return {
    type: "skill.import",
    source: { kind: "upload", files: [{ path: "SKILL.md", text: "---\n---\n" }] },
    scope: "project",
    ...over,
  };
}

describe("skill.list", () => {
  it("needs nothing but its type", () => {
    assert.equal(isClientMessage({ type: "skill.list" }), true);
  });
});

describe("skill.import", () => {
  it("accepts an upload and a git source", () => {
    assert.equal(isClientMessage(importMsg()), true);
    assert.equal(
      isClientMessage(
        importMsg({ source: { kind: "git", url: "https://example.com/r" } }),
      ),
      true,
    );
  });

  it("accepts an optional name and both scopes", () => {
    assert.equal(isClientMessage(importMsg({ name: "pdf-forms" })), true);
    assert.equal(isClientMessage(importMsg({ scope: "user" })), true);
  });

  it("refuses a scope that is not one of the two", () => {
    assert.equal(isClientMessage(importMsg({ scope: "global" })), false);
    assert.equal(isClientMessage(importMsg({ scope: undefined })), false);
  });

  it("refuses a name that could reach a path.join as a separator", () => {
    for (const name of ["../escape", "a/b", "..", ".", "a\\b"]) {
      assert.equal(isClientMessage(importMsg({ name })), false, name);
    }
  });

  it("refuses a source that is neither kind", () => {
    assert.equal(isClientMessage(importMsg({ source: { kind: "zip" } })), false);
    assert.equal(isClientMessage(importMsg({ source: "https://x" })), false);
    assert.equal(isClientMessage(importMsg({ source: null })), false);
  });

  describe("upload paths", () => {
    function withPath(p: unknown): unknown {
      return importMsg({
        source: { kind: "upload", files: [{ path: p, text: "x" }] },
      });
    }

    it("accepts a nested relative path", () => {
      assert.equal(isClientMessage(withPath("references/api.md")), true);
    });

    it("refuses anything that could climb out of the skill folder", () => {
      for (const p of [
        "../outside.md",
        "a/../../b.md",
        "/etc/passwd",
        "C:\\win.md",
        "a\\b.md",
        "./a.md",
        "a//b.md",
        "",
      ]) {
        assert.equal(isClientMessage(withPath(p)), false, p);
      }
    });

    it("refuses a null byte", () => {
      assert.equal(isClientMessage(withPath("a\0.md")), false);
    });
  });

  it("refuses an empty upload", () => {
    assert.equal(
      isClientMessage(importMsg({ source: { kind: "upload", files: [] } })),
      false,
    );
  });

  it("caps the file count", () => {
    const files = Array.from({ length: SKILL_MAX_UPLOAD_FILES + 1 }, (_, i) => ({
      path: `f${i}.md`,
      text: "x",
    }));
    assert.equal(
      isClientMessage(importMsg({ source: { kind: "upload", files } })),
      false,
    );
  });

  it("caps one file, and the sum of them", () => {
    assert.equal(
      isClientMessage(
        importMsg({
          source: {
            kind: "upload",
            files: [
              { path: "a.md", text: "x".repeat(SKILL_MAX_UPLOAD_FILE_CHARS + 1) },
            ],
          },
        }),
      ),
      false,
    );

    // Each file inside its own cap, the total over — the case a per-file check
    // alone would pass.
    const each = SKILL_MAX_UPLOAD_FILE_CHARS;
    const count = Math.ceil(SKILL_MAX_UPLOAD_TOTAL_CHARS / each) + 1;
    const files = Array.from({ length: count }, (_, i) => ({
      path: `f${i}.md`,
      text: "x".repeat(each),
    }));
    assert.equal(
      isClientMessage(importMsg({ source: { kind: "upload", files } })),
      false,
    );
  });

  it("refuses a git source with no url", () => {
    assert.equal(
      isClientMessage(importMsg({ source: { kind: "git", url: "" } })),
      false,
    );
    assert.equal(
      isClientMessage(importMsg({ source: { kind: "git" } })),
      false,
    );
  });

  it("refuses a git subpath that climbs out of the clone", () => {
    assert.equal(
      isClientMessage(
        importMsg({
          source: { kind: "git", url: "https://x/r", subpath: "../../etc" },
        }),
      ),
      false,
    );
  });
});

describe("skill.delete", () => {
  it("accepts a name the import path would refuse", () => {
    // A folder whose name is not kebab-case is exactly the one an operator
    // most wants to be able to remove.
    assert.equal(
      isClientMessage({ type: "skill.delete", name: "Not Kebab", scope: "user" }),
      true,
    );
  });

  it("still refuses a name carrying a separator", () => {
    assert.equal(
      isClientMessage({ type: "skill.delete", name: "../x", scope: "user" }),
      false,
    );
  });
});
