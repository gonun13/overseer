import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Stats } from "node:fs";
import { createGitProbe } from "../src/vcs/probe.js";

/** A `.git` directory whose HEAD/packed-refs identity the test controls. */
function fakeStat(head: { mtimeMs: number; size: number } | null) {
  return async (target: unknown): Promise<Stats> => {
    const file = String(target);
    if (file.endsWith("/.git")) {
      return { isDirectory: () => true } as Stats;
    }
    if (file.endsWith("/HEAD")) {
      if (head === null) throw new Error("ENOENT");
      return { ...head, isDirectory: () => false } as unknown as Stats;
    }
    throw new Error("ENOENT");
  };
}

function timeoutError(): Error & { killed: boolean; signal: string } {
  return Object.assign(new Error("Command failed: git status --porcelain"), {
    killed: true,
    signal: "SIGTERM",
  });
}

const DIR = "/workspace/alpha";

describe("createGitProbe", () => {
  it("skips the branch probe while HEAD is unchanged", async () => {
    const args: string[][] = [];
    let head = { mtimeMs: 10, size: 21 };
    let clock = 0;
    const probe = createGitProbe({
      run: async (_dir, argv) => {
        args.push(argv);
        return { stdout: argv[0] === "branch" ? "main\n" : "" };
      },
      stat: ((target: unknown) => fakeStat(head)(target)) as never,
      now: () => clock,
    });

    assert.deepEqual(await probe.read(DIR), { gitBranch: "main", dirty: false });
    assert.equal(args.filter((a) => a[0] === "branch").length, 1);

    // Same HEAD, inside the dirtiness floor: no git at all.
    clock += 1_000;
    assert.deepEqual(await probe.read(DIR), { gitBranch: "main", dirty: false });
    assert.equal(args.length, 2);

    // HEAD moved: the branch is read again.
    head = { mtimeMs: 20, size: 21 };
    assert.deepEqual(await probe.read(DIR), { gitBranch: "main", dirty: false });
    assert.equal(args.filter((a) => a[0] === "branch").length, 2);
  });

  it("probes dirtiness on the floor or when forced", async () => {
    const args: string[][] = [];
    let clock = 0;
    const probe = createGitProbe({
      run: async (_dir, argv) => {
        args.push(argv);
        return { stdout: argv[0] === "branch" ? "main\n" : "" };
      },
      stat: fakeStat({ mtimeMs: 10, size: 21 }) as never,
      now: () => clock,
      dirtyMinMs: 15_000,
    });

    await probe.read(DIR);
    const afterFirst = args.filter((a) => a[0] === "status").length;

    clock += 1_000;
    await probe.read(DIR);
    assert.equal(args.filter((a) => a[0] === "status").length, afterFirst);

    clock += 1_000;
    await probe.read(DIR, { force: true });
    assert.equal(args.filter((a) => a[0] === "status").length, afterFirst + 1);

    clock += 15_000;
    await probe.read(DIR);
    assert.equal(args.filter((a) => a[0] === "status").length, afterFirst + 2);
  });

  it("keeps the last good branch when a probe is killed", async () => {
    let head = { mtimeMs: 10, size: 21 };
    let failing = false;
    let clock = 0;
    const probe = createGitProbe({
      run: async (_dir, argv) => {
        if (failing) throw timeoutError();
        return { stdout: argv[0] === "branch" ? "main\n" : "" };
      },
      stat: ((target: unknown) => fakeStat(head)(target)) as never,
      now: () => clock,
    });

    assert.deepEqual(await probe.read(DIR), { gitBranch: "main", dirty: false });
    probe.takeEvents();

    failing = true;
    head = { mtimeMs: 20, size: 21 };
    clock += 20_000;
    // The mount stalled — the panel must still say `main`, not "unknown".
    assert.deepEqual(await probe.read(DIR), { gitBranch: "main", dirty: false });
  });

  it("reports a stall once, and the recovery once", async () => {
    let failing = true;
    let clock = 0;
    const probe = createGitProbe({
      run: async (_dir, argv) => {
        if (failing) throw timeoutError();
        return { stdout: argv[0] === "branch" ? "main\n" : "" };
      },
      stat: fakeStat({ mtimeMs: 10, size: 21 }) as never,
      now: () => clock,
    });

    for (let tick = 0; tick < 3; tick += 1) {
      clock += 20_000;
      await probe.read(DIR);
    }
    const stalls = probe.takeEvents();
    assert.equal(stalls.length, 1);
    assert.equal(stalls[0]?.kind, "timeout");
    assert.match(stalls[0]?.detail ?? "", /killed after/);

    failing = false;
    clock += 20_000;
    await probe.read(DIR);
    clock += 20_000;
    await probe.read(DIR);
    const recovered = probe.takeEvents();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.kind, "recovered");
  });

  it("flags a slow probe that still answered", async () => {
    let clock = 0;
    const probe = createGitProbe({
      run: async (_dir, argv) => {
        clock += 2_000;
        return { stdout: argv[0] === "branch" ? "main\n" : "" };
      },
      stat: fakeStat({ mtimeMs: 10, size: 21 }) as never,
      now: () => clock,
      slowMs: 1_000,
    });

    assert.deepEqual(await probe.read(DIR), { gitBranch: "main", dirty: false });
    const events = probe.takeEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0]?.kind, "slow");
  });

  it("reads detached HEAD as detached and forgets a dropped project", async () => {
    let calls = 0;
    const probe = createGitProbe({
      run: async (_dir, argv) => {
        calls += 1;
        return { stdout: argv[0] === "branch" ? "\n" : " M file\n" };
      },
      stat: fakeStat({ mtimeMs: 10, size: 21 }) as never,
      now: () => 0,
    });

    assert.deepEqual(await probe.read(DIR), {
      gitBranch: "detached",
      dirty: true,
    });

    const afterFirst = calls;
    probe.forget(DIR);
    await probe.read(DIR);
    // Cache dropped: both probes run again from scratch.
    assert.equal(calls, afterFirst + 2);
  });

  it("readMany fills a listing without losing name or path", async () => {
    const probe = createGitProbe({
      run: async (_dir, argv) => ({
        stdout: argv[0] === "branch" ? "dev\n" : "",
      }),
      stat: fakeStat({ mtimeMs: 10, size: 21 }) as never,
      now: () => 0,
    });

    const filled = await probe.readMany([
      { name: "alpha", path: "/workspace/alpha" },
      { name: "beta", path: "/workspace/beta" },
    ]);

    assert.deepEqual(filled, [
      { name: "alpha", path: "/workspace/alpha", gitBranch: "dev", dirty: false },
      { name: "beta", path: "/workspace/beta", gitBranch: "dev", dirty: false },
    ]);
  });
});
