import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SUBAGENT_MAX_NAME_CHARS,
  SUBAGENT_MAX_PROMPT_CHARS,
  SUBAGENT_NAME_PATTERN,
  isClientMessage,
} from "@overseer/protocol";

/**
 * The socket is a trust boundary, and these three frames are the first that
 * end in a file being written. Lives in the server's suite rather than the
 * protocol package's because the server already depends on protocol and
 * already has a runner — a first test script in `protocol` would be more
 * scaffolding than the cases justify.
 */

function write(over: Record<string, unknown> = {}): unknown {
  return {
    type: "subagent.write",
    name: "reviewer",
    description: "Reviews code",
    prompt: "You are the reviewer.",
    model: "",
    tools: "",
    scope: "project",
    ...over,
  };
}

describe("subagent.write validation", () => {
  it("accepts a well-formed frame", () => {
    assert.equal(isClientMessage(write()), true);
  });

  it("accepts a rename, with and without a scope move", () => {
    assert.equal(isClientMessage(write({ previousName: "auditor" })), true);
    assert.equal(
      isClientMessage(write({ previousName: "auditor", previousScope: "user" })),
      true,
    );
  });

  for (const [label, over] of [
    ["a missing name", { name: undefined }],
    ["an empty name", { name: "" }],
    ["an over-long name", { name: "a".repeat(SUBAGENT_MAX_NAME_CHARS + 1) }],
    ["a non-string description", { description: 7 }],
    ["an over-long prompt", { prompt: "x".repeat(SUBAGENT_MAX_PROMPT_CHARS + 1) }],
    ["a missing model field", { model: undefined }],
    ["a non-string tools field", { tools: ["Read"] }],
    ["an unknown scope", { scope: "global" }],
    ["a missing scope", { scope: undefined }],
    ["a bad previousScope", { previousName: "a", previousScope: "global" }],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.equal(isClientMessage(write(over as Record<string, unknown>)), false);
    });
  }

  it("accepts a name the server will go on to refuse", () => {
    // Deliberate: shape and length here, format in the server, so a badly
    // formatted name earns a sentence explaining the rule rather than a frame
    // silently dropped as unrecognized.
    const frame = write({ name: "Code Reviewer" });
    assert.equal(isClientMessage(frame), true);
    assert.equal(SUBAGENT_NAME_PATTERN.test("Code Reviewer"), false);
  });
});

describe("subagent.list and subagent.delete validation", () => {
  it("accepts a bare list", () => {
    assert.equal(isClientMessage({ type: "subagent.list" }), true);
  });

  it("accepts a delete", () => {
    assert.equal(
      isClientMessage({ type: "subagent.delete", name: "reviewer", scope: "user" }),
      true,
    );
  });

  it("accepts a delete for a name the write path would refuse", () => {
    // The asymmetry is the point: a hand-written file with an unusable name
    // has to remain removable.
    assert.equal(
      isClientMessage({
        type: "subagent.delete",
        name: "code reviewer",
        scope: "project",
      }),
      true,
    );
  });

  it("rejects a delete with no scope", () => {
    assert.equal(
      isClientMessage({ type: "subagent.delete", name: "reviewer" }),
      false,
    );
  });
});
