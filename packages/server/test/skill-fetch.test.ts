import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSkillGitSource } from "../src/skill-fetch.js";
import { isAllowedCloneUrl } from "../src/vcs/clone.js";

describe("parseSkillGitSource", () => {
  it("splits a forge folder url into clone url, ref and subpath", () => {
    assert.deepEqual(
      parseSkillGitSource("https://github.com/owner/repo/tree/main/skills/pdf"),
      {
        url: "https://github.com/owner/repo",
        ref: "main",
        subpath: "skills/pdf",
      },
    );
  });

  it("takes the folder of a blob url, since the skill is the directory", () => {
    assert.deepEqual(
      parseSkillGitSource(
        "https://github.com/owner/repo/blob/main/skills/pdf/SKILL.md",
      ),
      {
        url: "https://github.com/owner/repo",
        ref: "main",
        subpath: "skills/pdf",
      },
    );
  });

  it("reads a ref with no subpath", () => {
    assert.deepEqual(
      parseSkillGitSource("https://github.com/owner/repo/tree/v2"),
      { url: "https://github.com/owner/repo", ref: "v2" },
    );
  });

  it("leaves a plain clone url alone", () => {
    assert.deepEqual(parseSkillGitSource("https://github.com/owner/repo.git"), {
      url: "https://github.com/owner/repo.git",
    });
  });

  it("ignores a trailing slash rather than producing an empty segment", () => {
    assert.deepEqual(
      parseSkillGitSource("https://github.com/owner/repo/tree/main/skills/pdf/"),
      {
        url: "https://github.com/owner/repo",
        ref: "main",
        subpath: "skills/pdf",
      },
    );
  });

  it("does not invent a split from a url it does not understand", () => {
    // `tree` too early to be a marker — that is a repo named tree, not a ref.
    assert.deepEqual(parseSkillGitSource("https://example.com/tree/main"), {
      url: "https://example.com/tree/main",
    });
  });

  it("returns a non-url unchanged rather than throwing", () => {
    assert.deepEqual(parseSkillGitSource("not a url"), { url: "not a url" });
  });
});

describe("isAllowedCloneUrl", () => {
  it("allows https", () => {
    assert.equal(isAllowedCloneUrl("https://github.com/owner/repo"), true);
    assert.equal(isAllowedCloneUrl("  https://example.com/x.git  "), true);
  });

  for (const url of [
    // Reads the container's own filesystem — the staging directory sits beside
    // the operator's projects.
    "file:///etc/passwd",
    "/workspace/other-project",
    "../escape",
    // Executes an arbitrary command, by design.
    "ext::sh -c whoami",
    // Would spend the instance's own key against a host the operator chose.
    "ssh://git@github.com/owner/repo",
    "git@github.com:owner/repo.git",
    "git://github.com/owner/repo",
    // Cleartext: a skill is code a session will act on.
    "http://github.com/owner/repo",
  ]) {
    it(`refuses ${url}`, () => {
      assert.equal(isAllowedCloneUrl(url), false);
    });
  }

  it("refuses a host that would reach git's argv as a flag", () => {
    assert.equal(isAllowedCloneUrl("https://-oProxyCommand=x/repo"), false);
  });

  it("refuses an empty or unparseable url", () => {
    assert.equal(isAllowedCloneUrl(""), false);
    assert.equal(isAllowedCloneUrl("   "), false);
    assert.equal(isAllowedCloneUrl("https://"), false);
  });
});
