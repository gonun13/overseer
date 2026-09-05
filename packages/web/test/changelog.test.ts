import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseChangelog } from "../src/changelog.ts";

const SAMPLE = `# Changelog

Prose before the first release heading, which the window never shows.

## 0.2.1 — 2026-09-05

### Added

- Permission requests appear inline in the session that raised them,
  answered with allow once, allow always, or deny.
- A \`/changelog\` window.

### Fixed

- A session resumed after an idle reap keeps its model.

## 0.2.0
`;

describe("parseChangelog", () => {
  it("reads releases in the order they are authored", () => {
    assert.deepEqual(
      parseChangelog(SAMPLE).map((release) => release.version),
      ["0.2.1", "0.2.0"],
    );
  });

  it("splits a release into its sections and items", () => {
    const [latest] = parseChangelog(SAMPLE);
    assert.deepEqual(
      latest?.sections.map((section) => section.heading),
      ["Added", "Fixed"],
    );
    assert.equal(latest?.sections[0]?.items.length, 2);
    assert.equal(latest?.sections[1]?.items.length, 1);
  });

  it("joins a wrapped entry back into one line", () => {
    const [latest] = parseChangelog(SAMPLE);
    assert.equal(
      latest?.sections[0]?.items[0],
      "Permission requests appear inline in the session that raised them, answered with allow once, allow always, or deny.",
    );
  });

  it("takes the date only when the heading carries one", () => {
    const [latest, previous] = parseChangelog(SAMPLE);
    assert.equal(latest?.date, "2026-09-05");
    assert.equal(previous?.date, undefined);
    assert.deepEqual(previous?.sections, []);
  });

  it("ignores everything before the first release heading", () => {
    assert.deepEqual(parseChangelog("# Changelog\n\njust prose\n\n- a stray item"), []);
  });

  it("yields nothing rather than throwing on an empty file", () => {
    assert.deepEqual(parseChangelog(""), []);
  });

  it("keeps items that appear before any section heading", () => {
    const [release] = parseChangelog("## 0.1.0\n\n- first cut\n");
    assert.deepEqual(release?.sections, [
      { heading: "", items: ["first cut"] },
    ]);
  });
});
