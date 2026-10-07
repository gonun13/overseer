import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isClientMessage } from "@overseer/protocol";

/** The relay frames' shape checks — the socket is a trust boundary. */

describe("relay frames", () => {
  it("accepts a well-formed relay, rename and release", () => {
    assert.ok(
      isClientMessage({
        type: "console.relay",
        reqId: "r1",
        to: "linda",
        text: "go",
      }),
    );
    assert.ok(
      isClientMessage({ type: "callsign.rename", from: "linda", to: "Lucy" }),
    );
    assert.ok(
      isClientMessage({ type: "relay.release", id: "h1", release: false }),
    );
  });

  it("refuses missing or oversized fields", () => {
    assert.ok(
      !isClientMessage({
        type: "console.relay",
        reqId: "r1",
        to: "",
        text: "go",
      }),
    );
    assert.ok(
      !isClientMessage({ type: "console.relay", reqId: "r1", to: "linda" }),
    );
    assert.ok(
      !isClientMessage({
        type: "console.relay",
        reqId: "r1",
        to: "linda",
        text: "x".repeat(64_001),
      }),
    );
    assert.ok(!isClientMessage({ type: "callsign.rename", from: "linda" }));
    assert.ok(
      !isClientMessage({ type: "relay.release", id: "h1", release: "yes" }),
    );
  });
});
