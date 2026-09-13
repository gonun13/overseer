import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canPull, canPush } from "../src/state/git-actions.ts";

/** A clean checkout with a remote, level with it. Each test bends one thing. */
const level = { dirty: false, hasRemote: true, ahead: 0, behind: 0 };

describe("canPush", () => {
  it("is live with commits to send and nothing waiting at the remote", () => {
    assert.equal(canPush({ ...level, ahead: 2 }), true);
  });

  it("is held while the remote has commits this checkout does not", () => {
    // The case an operator hit: the window offered push, the remote rejected
    // it, and the reason was swallowed. Now the button holds instead.
    assert.equal(canPush({ ...level, ahead: 1, behind: 1 }), false);
  });

  it("is released by a pull — the same state, once behind is 0", () => {
    // This is the whole handover: the pull ack re-reads status, `behind` comes
    // back 0, and this flips without anything else changing.
    const beforePull = { ...level, ahead: 1, behind: 1 };
    const afterPull = { ...beforePull, behind: 0 };

    assert.equal(canPush(beforePull), false);
    assert.equal(canPush(afterPull), true);
  });

  it("is held over uncommitted work", () => {
    assert.equal(canPush({ ...level, ahead: 1, dirty: true }), false);
  });

  it("is held when the remote already has every commit", () => {
    assert.equal(canPush(level), false);
  });

  it("is live on a branch that has never been pushed", () => {
    // No upstream, so neither count exists — `push -u` is exactly the offer.
    assert.equal(canPush({ dirty: false, hasRemote: true }), true);
  });

  it("is held before the first status read", () => {
    assert.equal(canPush(undefined), false);
  });
});

describe("canPull", () => {
  it("is live when the remote is holding commits", () => {
    assert.equal(canPull({ ...level, behind: 3 }), true);
  });

  it("is held when there is nothing to pull", () => {
    assert.equal(canPull(level), false);
  });

  it("is held over uncommitted work — a merge cannot run over it", () => {
    assert.equal(canPull({ ...level, behind: 3, dirty: true }), false);
  });

  it("is held without a remote, and before the first status read", () => {
    assert.equal(canPull({ ...level, hasRemote: false, behind: 3 }), false);
    assert.equal(canPull(undefined), false);
  });

  it("is held on a branch with no upstream to compare against", () => {
    assert.equal(canPull({ dirty: false, hasRemote: true }), false);
  });
});

describe("push and pull together", () => {
  it("never offers both at once", () => {
    // Behind holds push; not-behind holds pull. There is no status where both
    // are live, which is what keeps the pair legible on screen.
    const states = [
      { ...level },
      { ...level, ahead: 2 },
      { ...level, behind: 2 },
      { ...level, ahead: 1, behind: 1 },
      { ...level, ahead: 1, behind: 1, dirty: true },
      { dirty: false, hasRemote: true },
    ];

    for (const status of states) {
      assert.equal(
        canPush(status) && canPull(status),
        false,
        `both live for ${JSON.stringify(status)}`,
      );
    }
  });
});
