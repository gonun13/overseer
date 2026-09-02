import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiscoveredProvider } from "@overseer/protocol";
import { pickAttachedProvider } from "../src/discovery.js";

const provider = (id: string, authenticated: boolean): DiscoveredProvider => ({
  id,
  status: { authenticated },
  login: true,
});

describe("pickAttachedProvider", () => {
  it("restores the previous pick when it is still registered, authenticated or not", () => {
    const results = [provider("claude-code", true), provider("cursor", false)];
    assert.equal(pickAttachedProvider("cursor", results)?.id, "cursor");
  });

  it("auto-attaches the first signed-in provider when nothing was ever picked", () => {
    const results = [provider("claude-code", false), provider("cursor", true)];
    assert.equal(pickAttachedProvider(undefined, results)?.id, "cursor");
  });

  it("auto-attaches when the previous pick is no longer registered (uninstalled, memory reset)", () => {
    const results = [provider("cursor", true)];
    assert.equal(pickAttachedProvider("claude-code", results)?.id, "cursor");
  });

  it("never auto-attaches an unauthenticated provider — that would trigger an unasked-for login flow", () => {
    const results = [provider("claude-code", false), provider("cursor", false)];
    assert.equal(pickAttachedProvider(undefined, results), undefined);
  });

  it("picks the first signed-in provider in list order when more than one qualifies", () => {
    const results = [provider("codex", true), provider("claude-code", true)];
    assert.equal(pickAttachedProvider(undefined, results)?.id, "codex");
  });

  it("reports nothing when there are no providers at all", () => {
    assert.equal(pickAttachedProvider(undefined, []), undefined);
  });
});
