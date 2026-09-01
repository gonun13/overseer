import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  loopSessionIndex,
  loopSlug,
  readLoopLeases,
  readLoopSessionRecords,
  sweepDeadLoopSessions,
  takeoverLoop,
} from "../src/loop-sessions.js";

/**
 * The loop's lease read from its own file store. Fixtures are real files —
 * the point of this module is the on-disk contract with `loop/bin/lib/db.sh`,
 * and a fake fs would only assert our own idea of it.
 */

async function storeWith(
  leases: Record<string, unknown | undefined>,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "loop-db-"));
  for (const [slug, record] of Object.entries(leases)) {
    await mkdir(path.join(dir, slug), { recursive: true });
    if (record === undefined) continue;
    await writeFile(
      path.join(dir, slug, "running.json"),
      typeof record === "string" ? record : JSON.stringify(record),
    );
  }
  return dir;
}

const alive = () => true;
const dead = () => false;

describe("readLoopLeases", () => {
  it("reads a lease that records a session id", async () => {
    const loopDbDir = await storeWith({
      personal: {
        slug: "personal",
        pid: 4242,
        started_at: "2026-09-01T21:06:03Z",
        tty: "dumb",
        session_id: "8709ee38-a414-40b1-b2d7-a22c6f63ba09",
      },
    });
    const leases = await readLoopLeases({ loopDbDir, isAlive: alive });
    assert.equal(leases.length, 1);
    assert.equal(leases[0]!.slug, "personal");
    assert.equal(leases[0]!.pid, 4242);
    assert.equal(
      leases[0]!.sessionId,
      "8709ee38-a414-40b1-b2d7-a22c6f63ba09",
    );
  });

  it("accepts a lease written before session ids were recorded", async () => {
    // The shape `running_claim` wrote before this feature, and the explicit
    // null it writes when a bundle had no id to give. Neither is an error:
    // the run is live, it just cannot be attributed to a session.
    const loopDbDir = await storeWith({
      legacy: { slug: "legacy", pid: 11, started_at: "x", tty: "dumb" },
      nulled: {
        slug: "nulled",
        pid: 12,
        started_at: "x",
        tty: "dumb",
        session_id: null,
      },
    });
    const leases = await readLoopLeases({ loopDbDir, isAlive: alive });
    assert.equal(leases.length, 2);
    for (const lease of leases) assert.equal(lease.sessionId, undefined);
  });

  it("ignores a lease whose holder is gone", async () => {
    const loopDbDir = await storeWith({
      personal: { slug: "personal", pid: 4242, session_id: "abc" },
    });
    assert.deepEqual(await readLoopLeases({ loopDbDir, isAlive: dead }), []);
  });

  it("ignores malformed, empty and absent leases without throwing", async () => {
    const loopDbDir = await storeWith({
      broken: "{not json",
      noPid: { slug: "noPid", session_id: "abc" },
      badPid: { slug: "badPid", pid: 0, session_id: "abc" },
      neverRan: undefined,
    });
    assert.deepEqual(await readLoopLeases({ loopDbDir, isAlive: alive }), []);
  });

  it("reports nothing when the loop store does not exist", async () => {
    const leases = await readLoopLeases({
      loopDbDir: path.join(tmpdir(), "loop-db-does-not-exist"),
      isAlive: alive,
    });
    assert.deepEqual(leases, []);
  });
});

describe("loopSessionIndex", () => {
  it("keys live runs by session id and skips those without one", async () => {
    const loopDbDir = await storeWith({
      personal: { slug: "personal", pid: 1, session_id: "sid-1" },
      legacy: { slug: "legacy", pid: 2 },
    });
    const index = await loopSessionIndex({ loopDbDir, isAlive: alive });
    assert.equal(index.size, 1);
    assert.equal(index.get("sid-1")?.slug, "personal");
  });
});

describe("sweepDeadLoopSessions", () => {
  async function storeWithRecords(
    slug: string,
    lines: string,
    lease?: unknown,
  ): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "loop-db-"));
    await mkdir(path.join(dir, slug), { recursive: true });
    await writeFile(path.join(dir, slug, "sessions.jsonl"), lines);
    if (lease !== undefined) {
      await writeFile(
        path.join(dir, slug, "running.json"),
        JSON.stringify(lease),
      );
    }
    return dir;
  }

  const line = (id: string, dir = "/workspace/demo") =>
    `${JSON.stringify({ id, dir, started_at: "x" })}\n`;

  it("deletes every recorded run when none is live", async () => {
    const loopDbDir = await storeWithRecords(
      "demo",
      line("dead-1") + line("dead-2"),
    );
    const deleted: Array<[string, string]> = [];
    const swept = await sweepDeadLoopSessions(
      async (projectDir, id) => {
        deleted.push([projectDir, id]);
      },
      { loopDbDir, isAlive: alive },
    );
    assert.deepEqual(swept.sort(), ["dead-1", "dead-2"]);
    assert.deepEqual(deleted, [
      ["/workspace/demo", "dead-1"],
      ["/workspace/demo", "dead-2"],
    ]);
    // The record is emptied, so a second sweep is a no-op rather than a
    // retry of deletes that already happened.
    const again = await sweepDeadLoopSessions(async () => {}, {
      loopDbDir,
      isAlive: alive,
    });
    assert.deepEqual(again, []);
  });

  it("spares the run holding the lease", async () => {
    const loopDbDir = await storeWithRecords(
      "demo",
      line("dead") + line("live"),
      { slug: "demo", pid: 4242, session_id: "live" },
    );
    const deleted: string[] = [];
    const swept = await sweepDeadLoopSessions(
      async (_dir, id) => {
        deleted.push(id);
      },
      { loopDbDir, isAlive: alive },
    );
    assert.deepEqual(swept, ["dead"]);
    assert.deepEqual(deleted, ["dead"]);

    // ...and it stays spared on the next sweep, while the lease holds.
    const again = await sweepDeadLoopSessions(async () => {}, {
      loopDbDir,
      isAlive: alive,
    });
    assert.deepEqual(again, []);
    const records = await readLoopSessionRecords({ loopDbDir, isAlive: alive });
    assert.deepEqual(
      records.map((r) => r.id),
      ["live"],
    );
  });

  it("sweeps a run whose lease holder has died", async () => {
    // The lease file outlives a killed run; liveness is what decides.
    const loopDbDir = await storeWithRecords("demo", line("orphan"), {
      slug: "demo",
      pid: 4242,
      session_id: "orphan",
    });
    const swept = await sweepDeadLoopSessions(async () => {}, {
      loopDbDir,
      isAlive: dead,
    });
    assert.deepEqual(swept, ["orphan"]);
  });

  it("keeps a record whose delete failed, so the next sweep retries", async () => {
    const loopDbDir = await storeWithRecords("demo", line("stubborn"));
    const swept = await sweepDeadLoopSessions(
      async () => {
        throw new Error("EBUSY");
      },
      { loopDbDir, isAlive: alive },
    );
    assert.deepEqual(swept, []);
    const records = await readLoopSessionRecords({ loopDbDir, isAlive: alive });
    assert.deepEqual(
      records.map((r) => r.id),
      ["stubborn"],
    );
  });

  it("ignores malformed lines and does nothing without a record", async () => {
    const loopDbDir = await storeWithRecords(
      "demo",
      `{not json\n${JSON.stringify({ id: "no-dir" })}\n\n`,
    );
    const swept = await sweepDeadLoopSessions(async () => {}, {
      loopDbDir,
      isAlive: alive,
    });
    assert.deepEqual(swept, []);
  });
});

describe("loopSlug", () => {
  it("matches slugify in loop/bin/lib/common.sh", () => {
    assert.equal(loopSlug("personal"), "personal");
    assert.equal(loopSlug("my.project"), "my-project");
    assert.equal(loopSlug("a_b-c.d"), "a-b-c-d");
  });
});

describe("takeoverLoop", () => {
  it("does nothing when no run holds the lease", async () => {
    const loopDbDir = await storeWith({});
    const result = await takeoverLoop("personal", {
      loopDbDir,
      isAlive: alive,
    });
    assert.deepEqual(result, { ok: true, killed: false });
  });

  it("refuses a pid that is not a loop run", async () => {
    // A lease outlives a crash, and pids get recycled — signalling on the
    // strength of the file alone would kill an unrelated process.
    const loopDbDir = await storeWith({
      personal: { slug: "personal", pid: 4242, session_id: "sid" },
    });
    const killed: number[] = [];
    const result = await takeoverLoop("personal", {
      loopDbDir,
      isAlive: alive,
      readCmdline: async () => "/usr/bin/something-else\0--flag",
      kill: (pid) => killed.push(pid),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /not a loop run/);
    assert.deepEqual(killed, []);
  });

  it("terminates a confirmed loop run", async () => {
    const loopDbDir = await storeWith({
      personal: { slug: "personal", pid: 4242, session_id: "sid" },
    });
    const signals: Array<{ pid: number; signal: string }> = [];
    let liveCalls = 0;
    const result = await takeoverLoop("personal", {
      loopDbDir,
      // Alive for the lease read, then dead once signalled.
      isAlive: () => ++liveCalls < 2,
      readCmdline: async () => "bash\0/app/loop/run\0personal",
      kill: (pid, signal) => signals.push({ pid, signal }),
      graceMs: 500,
      pollMs: 5,
    });
    assert.deepEqual(result, { ok: true, killed: true });
    assert.deepEqual(signals, [{ pid: 4242, signal: "SIGTERM" }]);
  });

  it("escalates to SIGKILL when the run ignores SIGTERM", async () => {
    const loopDbDir = await storeWith({
      personal: { slug: "personal", pid: 4242, session_id: "sid" },
    });
    const signals: string[] = [];
    const result = await takeoverLoop("personal", {
      loopDbDir,
      isAlive: alive,
      readCmdline: async () => "bash\0/app/loop/run\0personal",
      kill: (_pid, signal) => signals.push(signal),
      graceMs: 30,
      pollMs: 5,
    });
    assert.deepEqual(result, { ok: true, killed: true });
    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  });

  it("resolves the lease through the same slug rule the loop uses", async () => {
    const loopDbDir = await storeWith({
      "my-project": { slug: "my-project", pid: 7, session_id: "sid" },
    });
    const signals: number[] = [];
    const result = await takeoverLoop("my.project", {
      loopDbDir,
      isAlive: () => signals.length === 0,
      readCmdline: async () => "bash\0/app/loop/run\0my.project",
      kill: (pid) => signals.push(pid),
      graceMs: 200,
      pollMs: 5,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(signals, [7]);
  });
});
