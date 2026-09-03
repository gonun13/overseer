import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  providerAuthActivity,
  providerAuthLabel,
} from "../src/components/usageDisplay.ts";

describe("providerAuthLabel", () => {
  it("says signed in, not signed in, and unreachable for wired providers", () => {
    assert.equal(providerAuthLabel({ authenticated: true }), "signed in");
    assert.equal(providerAuthLabel({ authenticated: false }), "not signed in");
    assert.equal(
      providerAuthLabel({ authenticated: false, reachable: false }),
      "unreachable",
    );
  });

  // A catalog stub is unauthenticated for a reason the operator cannot act on:
  // there is no login behind it to reach. "not signed in" would send them
  // looking for one.
  it("says not available yet for a catalog stub", () => {
    assert.equal(
      providerAuthLabel({ authenticated: false, detail: "not implemented" }, true),
      "not available yet",
    );
  });

  it("leaves a catalog stub's light idle rather than waiting", () => {
    assert.equal(providerAuthActivity({ authenticated: false }), "waiting");
    assert.equal(providerAuthActivity({ authenticated: false }, true), "idle");
  });
});
