import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dropEmptyIdentityEnv, resolveIdentityEnv } from "../src/vcs/env.js";

describe("dropEmptyIdentityEnv", () => {
  it("removes only the empty ones", () => {
    // This is the shape the compose files actually produce on a host with no
    // git identity: present, and empty. Git prefers an empty value over every
    // config file and then fails the commit, so it is worse than absent.
    const env: NodeJS.ProcessEnv = {
      GIT_AUTHOR_NAME: "",
      GIT_AUTHOR_EMAIL: "",
      GIT_COMMITTER_NAME: "Someone",
      GIT_COMMITTER_EMAIL: "",
      UNRELATED: "",
    };

    const dropped = dropEmptyIdentityEnv(env);

    assert.deepEqual(dropped.sort(), [
      "GIT_AUTHOR_EMAIL",
      "GIT_AUTHOR_NAME",
      "GIT_COMMITTER_EMAIL",
    ]);
    assert.equal("GIT_AUTHOR_NAME" in env, false);
    // A host that set a real value meant it.
    assert.equal(env.GIT_COMMITTER_NAME, "Someone");
    // Nothing outside git's identity vars is touched.
    assert.equal(env.UNRELATED, "");
  });

  it("does nothing when they are absent or set", () => {
    const env: NodeJS.ProcessEnv = { GIT_AUTHOR_NAME: "Someone" };
    assert.deepEqual(dropEmptyIdentityEnv(env), []);
    assert.equal(env.GIT_AUTHOR_NAME, "Someone");
  });
});

describe("resolveIdentityEnv precedence", () => {
  const configured = { name: "Nuno", email: "ada@example.com" };

  it("uses the operator's identity without consulting git", async () => {
    let probed = false;
    const env = await resolveIdentityEnv(
      "/w/demo",
      async () => configured,
      async () => {
        probed = true;
        return true;
      },
    );
    assert.equal(probed, false, "no need to ask git what it would resolve");
    assert.equal(env?.GIT_AUTHOR_NAME, "Nuno");
    assert.equal(env?.GIT_COMMITTER_EMAIL, "ada@example.com");
  });

  it("leaves a repository that already resolves one alone", async () => {
    const env = await resolveIdentityEnv(
      "/w/demo",
      async () => undefined,
      async () => true,
    );
    assert.equal(env, undefined);
  });

  it("falls back so a commit succeeds rather than failing on an empty ident", async () => {
    const env = await resolveIdentityEnv(
      "/w/demo",
      async () => undefined,
      async () => false,
    );
    assert.equal(env?.GIT_AUTHOR_NAME, "overseer");
  });
});
