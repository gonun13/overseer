import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentAdapter } from "@overseer/protocol";
import { startTranscriptMonitor } from "../src/transcript-monitor.js";
import type { WorldSnapshot } from "../src/memory/internal.js";

/**
 * The watcher that lets sessions the app did not start reach the list.
 * Everything is injected: no real fs watch, no timers longer than a test.
 */

function snapshot(providerId?: string): WorldSnapshot {
  return {
    at: new Date().toISOString(),
    runCount: 1,
    workspaceRoot: "/workspace",
    projects: [],
    providers: [],
    last_active_project: "/workspace/demo",
    ...(providerId !== undefined ? { attached_provider: providerId } : {}),
  } as WorldSnapshot;
}

function adapterWatching(dir: string | undefined): AgentAdapter {
  return {
    id: "claude-code",
    capabilities: {} as AgentAdapter["capabilities"],
    createSession: async () => {
      throw new Error("unused");
    },
    resumeSession: async () => {
      throw new Error("unused");
    },
    listSessions: async () => [],
    getStatus: async () => ({ authenticated: true }),
    ...(dir !== undefined ? { sessionsWatchPath: () => dir } : {}),
  };
}

/** A watch seam that hands the test the change callback. */
function fakeWatch() {
  const watched: string[] = [];
  let fire: ((filename: string | null) => void) | undefined;
  let closed = 0;
  return {
    watched,
    get closed() {
      return closed;
    },
    emit(filename: string | null) {
      fire?.(filename);
    },
    watchDir: (dir: string, onChange: (filename: string | null) => void) => {
      watched.push(dir);
      fire = onChange;
      return {
        close: () => {
          closed += 1;
        },
      };
    },
  };
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("startTranscriptMonitor", () => {
  it("watches the attached adapter's transcript directory", async () => {
    const watch = fakeWatch();
    const stop = startTranscriptMonitor(() => {}, {
      readSnapshot: async () => snapshot("claude-code"),
      getAdapter: () => adapterWatching("/home/overseer/.claude/projects"),
      watchDir: watch.watchDir,
      debounceMs: 5,
      pollMs: 10_000,
    });
    await tick(10);
    assert.deepEqual(watch.watched, ["/home/overseer/.claude/projects"]);
    stop();
    assert.equal(watch.closed, 1);
  });

  it("watches nothing when no provider is attached", async () => {
    const watch = fakeWatch();
    const stop = startTranscriptMonitor(() => {}, {
      readSnapshot: async () => snapshot(undefined),
      getAdapter: () => adapterWatching("/somewhere"),
      watchDir: watch.watchDir,
      debounceMs: 5,
      pollMs: 10_000,
    });
    await tick(10);
    assert.deepEqual(watch.watched, []);
    stop();
  });

  it("watches nothing when the adapter keeps no transcript directory", async () => {
    const watch = fakeWatch();
    const stop = startTranscriptMonitor(() => {}, {
      readSnapshot: async () => snapshot("codex"),
      getAdapter: () => adapterWatching(undefined),
      watchDir: watch.watchDir,
      debounceMs: 5,
      pollMs: 10_000,
    });
    await tick(10);
    assert.deepEqual(watch.watched, []);
    stop();
  });

  it("coalesces a burst of writes into one refresh", async () => {
    const watch = fakeWatch();
    let refreshes = 0;
    const stop = startTranscriptMonitor(
      () => {
        refreshes += 1;
      },
      {
        readSnapshot: async () => snapshot("claude-code"),
        getAdapter: () => adapterWatching("/projects"),
        watchDir: watch.watchDir,
        debounceMs: 20,
        pollMs: 10_000,
      },
    );
    await tick(10);

    // A streaming turn appends continuously; the trailing debounce must not
    // rebuild the list once per append.
    for (let i = 0; i < 10; i += 1) watch.emit("slug/session.jsonl");
    await tick(60);
    assert.equal(refreshes, 1);
    stop();
  });

  it("ignores changes that are not transcripts", async () => {
    const watch = fakeWatch();
    let refreshes = 0;
    const stop = startTranscriptMonitor(
      () => {
        refreshes += 1;
      },
      {
        readSnapshot: async () => snapshot("claude-code"),
        getAdapter: () => adapterWatching("/projects"),
        watchDir: watch.watchDir,
        debounceMs: 10,
        pollMs: 10_000,
      },
    );
    await tick(10);
    watch.emit("slug/sessions-index.json");
    watch.emit("slug/memory/notes.md");
    await tick(40);
    assert.equal(refreshes, 0);

    // ...but a transcript alongside them still lands.
    watch.emit("slug/abc.jsonl");
    await tick(40);
    assert.equal(refreshes, 1);
    stop();
  });

  it("refreshes on the poll even when the watcher reports nothing", async () => {
    const watch = fakeWatch();
    let refreshes = 0;
    const stop = startTranscriptMonitor(
      () => {
        refreshes += 1;
      },
      {
        readSnapshot: async () => snapshot("claude-code"),
        getAdapter: () => adapterWatching("/projects"),
        watchDir: watch.watchDir,
        debounceMs: 5,
        pollMs: 15,
      },
    );
    await tick(60);
    assert.ok(refreshes > 0, "poll fallback never fired");
    stop();
  });

  it("does not overlap refreshes, and runs once more for what arrived during one", async () => {
    const watch = fakeWatch();
    let started = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stop = startTranscriptMonitor(
      async () => {
        started += 1;
        if (started === 1) await blocked;
      },
      {
        readSnapshot: async () => snapshot("claude-code"),
        getAdapter: () => adapterWatching("/projects"),
        watchDir: watch.watchDir,
        debounceMs: 5,
        pollMs: 10_000,
      },
    );
    await tick(10);

    watch.emit("a.jsonl");
    await tick(20);
    assert.equal(started, 1);

    // Arrives while the first refresh is still running.
    watch.emit("b.jsonl");
    await tick(20);
    assert.equal(started, 1, "a second refresh ran concurrently");

    release();
    await tick(20);
    assert.equal(started, 2, "the change during the refresh was dropped");
    stop();
  });
});
