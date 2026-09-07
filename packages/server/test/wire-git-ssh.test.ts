import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isClientMessage } from "@overseer/protocol";

/**
 * Guards for the git-access frames.
 *
 * These live in the server's suite rather than `protocol`'s because
 * `protocol` ships types and pure functions with no test harness of its own,
 * and the server is the only thing that runs `isClientMessage` in anger.
 *
 * The host cases are regression tests, not hypotheticals: the first draft of
 * this guard was `/^[a-z0-9.-]+$/`, which passes `github.com` and silently
 * rejects a private single-label host and a bracketed IPv6 literal — two
 * shapes this project's own workspace remotes actually use.
 */
describe("git.ssh.test host guard", () => {
  const test = (host: unknown, port?: unknown) => {
    const frame: Record<string, unknown> = { type: "git.ssh.test", host };
    if (port !== undefined) frame.port = port;
    return isClientMessage(frame);
  };

  it("accepts an ordinary forge hostname", () => {
    assert.equal(test("github.com"), true);
  });

  it("accepts a private single-label host, with a non-default port", () => {
    // ssh://git@gitlab.local:2424/nuno-gomes/otm.git
    assert.equal(test("gitlab.local", 2424), true);
    assert.equal(test("gitlab"), true);
  });

  it("accepts a bracketed IPv6 literal", () => {
    // git@[2001:bc8:1d90:1f48:dc00:ff:fe2b:14e1]:repos/x.git
    assert.equal(test("[2001:bc8:1d90:1f48:dc00:ff:fe2b:14e1]"), true);
    assert.equal(test("[2001:db8::1]"), true);
  });

  it("rejects a malformed address inside brackets", () => {
    assert.equal(test("[not-an-address]"), false);
    assert.equal(test("[2001:db8::1::2]"), false);
    assert.equal(test("[]"), false);
  });

  it("rejects hostnames with a leading or trailing hyphen or empty label", () => {
    assert.equal(test("-github.com"), false);
    assert.equal(test("github-.com"), false);
    assert.equal(test("github..com"), false);
  });

  it("rejects anything that could reach a shell or another argument", () => {
    for (const host of [
      "github.com;rm -rf /",
      "github.com j",
      "-oProxyCommand=x",
      "git@github.com",
      "github.com/owner/repo",
    ]) {
      assert.equal(test(host), false, host);
    }
  });

  it("rejects an over-length host", () => {
    assert.equal(test(`${"a".repeat(254)}`), false);
  });

  it("rejects a port outside 1-65535, and a non-integer one", () => {
    assert.equal(test("github.com", 0), false);
    assert.equal(test("github.com", 65_536), false);
    assert.equal(test("github.com", 22.5), false);
    assert.equal(test("github.com", "22"), false);
  });
});

describe("git.identity.set guard", () => {
  const set = (name: unknown, email: unknown) =>
    isClientMessage({ type: "git.identity.set", name, email });

  it("accepts an ordinary identity", () => {
    assert.equal(set("Nuno Gomes", "ada@example.com"), true);
  });

  it("rejects config injection — these values reach a git config file", () => {
    assert.equal(set("x\n[user]\n\temail = attacker@evil", "a@b.c"), false);
    assert.equal(set("[user]", "a@b.c"), false);
    assert.equal(set("ok", "a@b.c\n\tname = someone"), false);
    assert.equal(set("ok\r", "a@b.c"), false);
  });

  it("rejects an empty or whitespace-only name", () => {
    assert.equal(set("", "a@b.c"), false);
    assert.equal(set("   ", "a@b.c"), false);
  });

  it("requires an @ and no whitespace in the email", () => {
    assert.equal(set("ok", "not-an-email"), false);
    assert.equal(set("ok", "a b@c.d"), false);
  });

  it("rejects over-length values", () => {
    assert.equal(set("n".repeat(129), "a@b.c"), false);
    // 254 exactly is the cap and must pass; one over must not.
    assert.equal(set("ok", `${"e".repeat(250)}@b.c`), true);
    assert.equal(set("ok", `${"e".repeat(251)}@b.c`), false);
  });
});

describe("git access frames that carry no payload", () => {
  it("accepts the three bare frames", () => {
    for (const type of [
      "git.access.read",
      "git.ssh.generate",
      "git.ssh.remove",
    ]) {
      assert.equal(isClientMessage({ type }), true, type);
    }
  });

  it("still rejects an unknown git frame", () => {
    assert.equal(isClientMessage({ type: "git.ssh.export" }), false);
  });
});
