import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowedHostnames, isAllowedHost } from "../src/host-guard.js";

/**
 * The Host allowlist — what stops a DNS-rebinding page whose Origin and Host
 * agree (spec/architecture.md §6).
 */

describe("host guard", () => {
  // Not `undefined`: that reads the env, and the dev stack sets `web` there.
  const allowed = allowedHostnames("");

  it("answers loopback names on any port", () => {
    for (const host of [
      "127.0.0.1:3000",
      "localhost:3000",
      "127.0.0.1:3001",
      "localhost:5173",
      "[::1]:3000",
      "LOCALHOST:3000",
      "127.0.0.1",
    ]) {
      assert.ok(isAllowedHost(host, allowed), host);
    }
  });

  it("refuses a rebound name, and anything that is not a bare host", () => {
    for (const host of [
      undefined,
      "",
      "evil.example:3000",
      "localhost.evil.example:3000",
      "127.0.0.1.nip.io:3000",
      "localhost.:3000",
      "evil.example@localhost:3000",
      "localhost:3000@evil.example",
      "localhost/evil.example",
      "web:5173",
    ]) {
      assert.ok(!isAllowedHost(host, allowed), String(host));
    }
  });

  it("adds the names OVERSEER_ALLOWED_HOSTS lists", () => {
    const dev = allowedHostnames(" web , Other ");
    assert.ok(isAllowedHost("web:5173", dev));
    assert.ok(isAllowedHost("other:3000", dev));
    assert.ok(isAllowedHost("localhost:3000", dev));
    assert.ok(!isAllowedHost("evil.example:3000", dev));
  });
});
