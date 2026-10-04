import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CALLSIGN_POOL, createCallsignBook } from "../src/callsigns.js";

/**
 * Callsigns: taken from the pool in order, unique ignoring case, persisted
 * only for session keys (spec/behaviour/relay.md §1).
 */

function book(initial: Record<string, string> = {}, exists: (key: string) => boolean = () => true) {
  const writes: Array<Record<string, string>> = [];
  const b = createCallsignBook({
    read: async () => ({ ...initial }),
    write: async (map) => {
      writes.push(map);
    },
    exists,
  });
  return { b, writes };
}

describe("callsigns", () => {
  it("keeps the pool free of duplicates and prefixes", () => {
    const lower = CALLSIGN_POOL.map((n) => n.toLowerCase());
    assert.equal(new Set(lower).size, lower.length);
    for (const a of lower) {
      for (const b of lower) {
        if (a !== b) assert.ok(!b.startsWith(a), `${a} is a prefix of ${b}`);
      }
    }
  });

  it("assigns pool names in order and keeps a key's name", async () => {
    const { b } = book();
    await b.ready;
    assert.equal(b.assign("s1", true), "Linda");
    assert.equal(b.assign("s2", true), "Bob");
    assert.equal(b.assign("s1", true), "Linda");
  });

  it("skips names already held, from the file", async () => {
    const { b } = book({ old: "Linda" });
    await b.ready;
    assert.equal(b.nameOf("old"), "Linda");
    assert.equal(b.assign("new", true), "Bob");
  });

  it("persists session keys only", async () => {
    const { b, writes } = book();
    await b.ready;
    b.assign("console-id", false);
    assert.equal(writes.length, 0);
    b.assign("session-id", true);
    assert.deepEqual(writes.at(-1), { "session-id": "Bob" });
  });

  it("looks up a key by callsign, ignoring case", async () => {
    const { b } = book();
    await b.ready;
    b.assign("s1", true);
    assert.equal(b.keyOf("LINDA"), "s1");
    assert.equal(b.keyOf("nobody"), undefined);
  });

  it("renames within the rules and refuses the rest", async () => {
    const { b, writes } = book();
    await b.ready;
    b.assign("s1", true);
    b.assign("s2", true);
    assert.deepEqual(b.rename("linda", "Lucy"), { ok: true, key: "s1" });
    assert.equal(b.nameOf("s1"), "Lucy");
    assert.deepEqual(writes.at(-1), { s1: "Lucy", s2: "Bob" });
    assert.equal(b.rename("lucy", "bob").ok, false);
    assert.equal(b.rename("lucy", "x").ok, false);
    assert.equal(b.rename("lucy", "9lives").ok, false);
    assert.equal(b.rename("lucy", "Overseer").ok, false);
    assert.equal(b.rename("nobody", "Ann").ok, false);
    // Recasing your own name is not taking someone else's.
    assert.equal(b.rename("lucy", "LUCY").ok, true);
  });

  it("moves a name to another key", async () => {
    const { b, writes } = book();
    await b.ready;
    b.assign("minted", true);
    b.move("minted", "console-1", false);
    assert.equal(b.nameOf("console-1"), "Linda");
    assert.equal(b.nameOf("minted"), undefined);
    assert.deepEqual(writes.at(-1), {});
  });

  it("frees a released name for the next session", async () => {
    const { b } = book();
    await b.ready;
    b.assign("s1", true);
    b.release("s1");
    assert.equal(b.assign("s2", true), "Linda");
  });

  it("reclaims names of sessions that no longer exist, then numbers", async () => {
    const full = Object.fromEntries(CALLSIGN_POOL.map((name, i) => [`s${i}`, name]));
    const gone = new Set(["s1"]);
    const { b } = book(full, (key) => !gone.has(key));
    await b.ready;
    assert.equal(b.assign("new1", true), "Bob");
    assert.equal(b.nameOf("s1"), undefined);
    assert.equal(b.assign("new2", true), "Linda2");
  });

  it("forgets everything but the keys kept", async () => {
    const { b } = book();
    await b.ready;
    b.assign("s1", true);
    b.assign("s2", true);
    b.forget(["s2"]);
    assert.equal(b.nameOf("s1"), undefined);
    assert.equal(b.nameOf("s2"), "Bob");
  });
});
