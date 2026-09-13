import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type {
  DiscoveredProject,
  ServerMessage,
  UntrackedFolder,
} from "@overseer/protocol";
import type { WorldSnapshot } from "../src/memory/internal.js";
import {
  beginIntentionalPersonalityDelete,
  createPersonalityFileWatcher,
  endIntentionalPersonalityDelete,
} from "../src/personality-file-watcher.js";
import {
  createWorkspaceMembershipWorker,
  emitProjectDiff,
  gitMetaKey,
  scanKey,
} from "../src/workspace-membership-worker.js";
import { startWorkspaceMonitor } from "../src/workspace-monitor.js";
import {
  createOverseerSpace,
  type OverseerSpace,
} from "../src/overseer/space.js";

const snapshot: WorldSnapshot = {
  at: "2026-01-01T00:00:00.000Z",
  runCount: 1,
  workspaceRoot: "/workspace",
  projects: [
    { name: "alpha", path: "/workspace/alpha", gitBranch: "main", dirty: false },
    { name: "overseer-personality", path: "/workspace/overseer-personality" },
  ],
  providers: [],
  last_active_project: "/workspace/alpha",
};

/** Services report through the space now, so the collector builds a real one
 * over the same broadcast — the frames the worker produces are exactly the
 * frames a tab would receive. */
function collectMessages(): {
  messages: ServerMessage[];
  broadcast: (message: ServerMessage) => void;
  space: OverseerSpace;
} {
  const messages: ServerMessage[] = [];
  const broadcast = (message: ServerMessage) => {
    messages.push(message);
  };
  return { messages, broadcast, space: createOverseerSpace(broadcast) };
}

/** A status row's label, whatever kind of frame it arrived on. */
function labelOf(message: ServerMessage): string | undefined {
  return message.type === "space.status" ? message.entry.label : undefined;
}

function isStatus(message: ServerMessage): boolean {
  return message.type === "space.status";
}

describe("workspace membership helpers", () => {
  it("scanKey orders projects and untracked paths", () => {
    const key = scanKey(
      [{ name: "a", path: "/workspace/a" }],
      [{ name: "b", path: "/workspace/b" }],
    );
    assert.equal(key, "p:/workspace/a\u0000u:/workspace/b");
  });

  it("gitMetaKey tracks branch and dirtiness", () => {
    const projects: DiscoveredProject[] = [
      { name: "a", path: "/workspace/a", gitBranch: "main", dirty: false },
      { name: "b", path: "/workspace/b", gitBranch: "dev", dirty: true },
    ];
    assert.notEqual(gitMetaKey(projects), gitMetaKey([{ ...projects[0]! }]));
  });

  it("emitProjectDiff broadcasts add and remove rows", () => {
    const { messages, space } = collectMessages();
    emitProjectDiff(
      space,
      [{ name: "gone", path: "/workspace/gone" }],
      [{ name: "new", path: "/workspace/new" }],
    );
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.type, "space.status");
    assert.match(labelOf(messages[0]!) ?? "", /adding project new/);
    assert.match(labelOf(messages[1]!) ?? "", /removing project gone/);
  });
});

describe("createWorkspaceMembershipWorker", () => {
  it("seeds from discovery snapshot on first refresh", async () => {
    const { broadcast, space } = collectMessages();
    const worker = createWorkspaceMembershipWorker(
      () => {},
      {
        scanWorkspace: mock.fn(async (_root, opts) =>
          opts?.git === false
            ? { projects: snapshot.projects, untracked: [] }
            : { projects: snapshot.projects, untracked: [] },
        ),
        gitMeta: mock.fn(async (projects) => projects),
        syncSnapshotProjects: mock.fn(async () => true),
        recordAction: mock.fn(async () => {}),
        watchWithRetry: () => () => undefined,
      },
    );

    await worker.refresh({
      broadcast,
      space,
      snapshot,
      personalityMissing: false,
      justNoticedMissing: false,
    });

    assert.deepEqual(worker.getState().lastProjects, snapshot.projects);
    assert.deepEqual(worker.getState().lastUntracked, []);
  });

  it("pushes git-only refresh without overseer steps", async () => {
    const { messages, broadcast, space } = collectMessages();
    const listed = snapshot.projects;
    const refreshed: DiscoveredProject[] = listed.map((project) =>
      project.path === "/workspace/alpha"
        ? { ...project, gitBranch: "dev", dirty: true }
        : project,
    );
    let gitRefreshCalls = 0;
    const worker = createWorkspaceMembershipWorker(
      () => {},
      {
        scanWorkspace: mock.fn(async () => ({
          projects: listed,
          untracked: [],
        })),
        gitMeta: mock.fn(async (projects) => {
          gitRefreshCalls += 1;
          return gitRefreshCalls === 1 ? projects : refreshed;
        }),
        syncSnapshotProjects: mock.fn(async () => true),
        recordAction: mock.fn(async () => {}),
        watchWithRetry: () => () => undefined,
      },
    );

    await worker.refresh({
      broadcast,
      space,
      snapshot,
      personalityMissing: false,
      justNoticedMissing: false,
    });
    messages.length = 0;

    await worker.refresh({
      broadcast,
      space,
      snapshot,
      personalityMissing: false,
      justNoticedMissing: false,
    });

    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.type, "workspace.projects");
    assert.equal(
      (messages[0] as { projects: DiscoveredProject[] }).projects.find(
        (p) => p.path === "/workspace/alpha",
      )?.gitBranch,
      "dev",
    );
    assert.ok(messages.every((m) => !isStatus(m)));
  });

  it("broadcasts membership diffs and active fallback", async () => {
    const { messages, broadcast, space } = collectMessages();
    const before = snapshot.projects;
    const after: DiscoveredProject[] = [
      { name: "overseer-personality", path: "/workspace/overseer-personality" },
    ];

    let listingCalls = 0;
    const worker = createWorkspaceMembershipWorker(
      () => {},
      {
        scanWorkspace: mock.fn(async (_root, opts) => {
          if (opts?.git === false) {
            listingCalls += 1;
            return listingCalls === 1
              ? { projects: before, untracked: [] }
              : { projects: after, untracked: [] };
          }
          return { projects: after, untracked: [] };
        }),
        gitMeta: mock.fn(async (projects) => projects),
        syncSnapshotProjects: mock.fn(async () => true),
        recordAction: mock.fn(async () => {}),
        watchWithRetry: () => () => undefined,
      },
    );

    await worker.refresh({
      broadcast,
      space,
      snapshot,
      personalityMissing: false,
      justNoticedMissing: false,
    });
    messages.length = 0;

    await worker.refresh({
      broadcast,
      space,
      snapshot,
      personalityMissing: false,
      justNoticedMissing: false,
    });

    const steps = messages.filter(isStatus);
    const panel = messages.find((m) => m.type === "workspace.projects");
    assert.ok(steps.some((m) => labelOf(m)?.includes("removing project alpha")));
    assert.equal(
      (panel as { activeProjectPath?: string } | undefined)?.activeProjectPath,
      "/workspace/overseer-personality",
    );
  });

  it("suppresses redundant personality project removal when config is missing", async () => {
    const { messages, broadcast, space } = collectMessages();
    const personalityPath = "/workspace/overseer-personality";
    const before: DiscoveredProject[] = [
      { name: "alpha", path: "/workspace/alpha" },
      { name: "overseer-personality", path: personalityPath },
    ];
    const after: DiscoveredProject[] = [
      { name: "alpha", path: "/workspace/alpha" },
    ];

    let listingCalls = 0;
    const worker = createWorkspaceMembershipWorker(
      () => {},
      {
        scanWorkspace: mock.fn(async (_root, opts) => {
          if (opts?.git === false) {
            listingCalls += 1;
            return listingCalls === 1
              ? { projects: before, untracked: [] }
              : { projects: after, untracked: [] };
          }
          return { projects: after, untracked: [] };
        }),
        gitMeta: mock.fn(async (projects) => projects),
        syncSnapshotProjects: mock.fn(async () => true),
        recordAction: mock.fn(async () => {}),
        personalityDir: () => personalityPath,
        watchWithRetry: () => () => undefined,
      },
    );

    await worker.refresh({
      broadcast,
      space,
      snapshot: { ...snapshot, projects: before },
      personalityMissing: false,
      justNoticedMissing: false,
    });
    messages.length = 0;

    await worker.refresh({
      broadcast,
      space,
      snapshot: { ...snapshot, projects: before },
      personalityMissing: true,
      justNoticedMissing: false,
    });

    const steps = messages.filter(isStatus);
    assert.ok(
      steps.every(
        (s) =>
          !labelOf(s)?.includes("removing project overseer-personality"),
      ),
    );
    const panel = messages.find((m) => m.type === "workspace.projects");
    assert.equal(
      (panel as { personalityMissing?: boolean } | undefined)?.personalityMissing,
      true,
    );
  });

  it("scans the workspace once per refresh, membership change included", async () => {
    const { broadcast, space } = collectMessages();
    const before = snapshot.projects;
    const after: DiscoveredProject[] = [
      { name: "overseer-personality", path: "/workspace/overseer-personality" },
    ];

    const scans: (boolean | undefined)[] = [];
    let listingCalls = 0;
    const worker = createWorkspaceMembershipWorker(
      () => {},
      {
        scanWorkspace: mock.fn(async (_root, opts) => {
          scans.push(opts?.git);
          listingCalls += 1;
          return listingCalls === 1
            ? { projects: before, untracked: [] }
            : { projects: after, untracked: [] };
        }),
        gitMeta: mock.fn(async (projects) => projects),
        syncSnapshotProjects: mock.fn(async () => true),
        recordAction: mock.fn(async () => {}),
        watchWithRetry: () => () => undefined,
      },
    );

    await worker.refresh({
      broadcast,
      space,
      snapshot,
      personalityMissing: false,
      justNoticedMissing: false,
    });
    // Second pass changes membership — the path that used to walk the root a
    // second time to fill git meta in.
    await worker.refresh({
      broadcast,
      space,
      snapshot,
      personalityMissing: false,
      justNoticedMissing: false,
    });

    assert.equal(scans.length, 2);
    assert.ok(scans.every((git) => git === false));
  });

  it("forgets cached git state for a project that left", async () => {
    const { broadcast, space } = collectMessages();
    const before = snapshot.projects;
    const after: DiscoveredProject[] = [
      { name: "overseer-personality", path: "/workspace/overseer-personality" },
    ];
    const forgotten: string[] = [];

    let listingCalls = 0;
    const worker = createWorkspaceMembershipWorker(
      () => {},
      {
        scanWorkspace: mock.fn(async () => {
          listingCalls += 1;
          return listingCalls === 1
            ? { projects: before, untracked: [] }
            : { projects: after, untracked: [] };
        }),
        gitMeta: mock.fn(async (projects) => projects),
        forgetGit: (dir) => {
          forgotten.push(dir);
        },
        syncSnapshotProjects: mock.fn(async () => true),
        recordAction: mock.fn(async () => {}),
        watchWithRetry: () => () => undefined,
      },
    );

    await worker.refresh({
      broadcast,
      space,
      snapshot,
      personalityMissing: false,
      justNoticedMissing: false,
    });
    await worker.refresh({
      broadcast,
      space,
      snapshot,
      personalityMissing: false,
      justNoticedMissing: false,
    });

    assert.deepEqual(forgotten, ["/workspace/alpha"]);
  });

  it("reports a stalled probe as a status row", async () => {
    const { messages, broadcast, space } = collectMessages();
    let taken = 0;
    const worker = createWorkspaceMembershipWorker(
      () => {},
      {
        scanWorkspace: mock.fn(async () => ({
          projects: snapshot.projects,
          untracked: [],
        })),
        gitMeta: mock.fn(async (projects) => projects),
        takeProbeEvents: () => {
          taken += 1;
          return taken === 1
            ? [
                {
                  dir: "/workspace/alpha",
                  kind: "timeout" as const,
                  command: "git status --porcelain",
                  ms: 15_000,
                  detail: "killed after 15.0s",
                },
              ]
            : [];
        },
        syncSnapshotProjects: mock.fn(async () => true),
        recordAction: mock.fn(async () => {}),
        watchWithRetry: () => () => undefined,
      },
    );

    await worker.refresh({
      broadcast,
      space,
      snapshot,
      personalityMissing: false,
      justNoticedMissing: false,
    });

    const step = messages.find(isStatus) as
      | { entry: { label: string; outcome: string; detail?: string } }
      | undefined;
    assert.equal(step?.entry.label, "git probe timeout in alpha");
    assert.equal(step?.entry.outcome, "blocked");
    assert.match(step?.entry.detail ?? "", /killed after 15\.0s/);
  });
});

describe("createPersonalityFileWatcher", () => {
  it("announces deletion once and reports missing state", async () => {
    const { messages, broadcast, space } = collectMessages();
    const watcher = createPersonalityFileWatcher(
      () => {},
      {
        personalityConfigExists: mock.fn(async () => false),
        personalityConfigPath: () => "/workspace/overseer-personality/personality.json",
        personalityDir: () => "/workspace/overseer-personality",
        readPersonality: mock.fn(async () => ({ applied: {}, rejected: [] })),
        readFile: mock.fn(async () => '{"tone":"dry"}'),
        recordAction: mock.fn(async () => {}),
        watchWithRetry: () => () => undefined,
      },
    );

    const first = await watcher.refresh({
      broadcast,
      space,
      snapshot,
      lastProjects: snapshot.projects,
      lastUntracked: [],
    });
    const second = await watcher.refresh({
      broadcast,
      space,
      snapshot,
      lastProjects: snapshot.projects,
      lastUntracked: [],
    });

    assert.equal(first.justNoticedMissing, true);
    assert.equal(second.justNoticedMissing, false);
    assert.equal(
      messages.filter((m) => labelOf(m) === "personality deleted").length,
      1,
    );
  });

  it("stays quiet when personality is deleted by an intentional reset", async () => {
    const { messages, broadcast, space } = collectMessages();
    const watcher = createPersonalityFileWatcher(
      () => {},
      {
        personalityConfigExists: mock.fn(async () => false),
        personalityConfigPath: () =>
          "/workspace/overseer-personality/personality.json",
        personalityDir: () => "/workspace/overseer-personality",
        readPersonality: mock.fn(async () => ({ applied: {}, rejected: [] })),
        readFile: mock.fn(async () => {
          throw new Error("ENOENT");
        }),
        recordAction: mock.fn(async () => {}),
        watchWithRetry: () => () => undefined,
      },
    );

    beginIntentionalPersonalityDelete();
    try {
      await watcher.refresh({
        broadcast,
        space,
      space,
        snapshot,
        lastProjects: snapshot.projects,
        lastUntracked: [],
      });
    } finally {
      endIntentionalPersonalityDelete();
    }

    assert.equal(
      messages.filter(isStatus).length,
      0,
    );
  });

  it("re-reads personality edits and broadcasts applied fields", async () => {
    const { messages, broadcast, space } = collectMessages();
    let body = '{"tone":"dry"}';
    const watcher = createPersonalityFileWatcher(
      () => {},
      {
        personalityConfigExists: mock.fn(async () => true),
        personalityConfigPath: () => "/workspace/overseer-personality/personality.json",
        personalityDir: () => "/workspace/overseer-personality",
        readPersonality: mock.fn(async () => ({
          applied: { tone: "warm" },
          rejected: [],
        })),
        readFile: mock.fn(async () => body),
        recordAction: mock.fn(async () => {}),
        watchWithRetry: () => () => undefined,
      },
    );

    await watcher.refresh({
      broadcast,
      space,
      snapshot,
      lastProjects: snapshot.projects,
      lastUntracked: [],
    });
    messages.length = 0;
    body = '{"tone":"warm"}';

    await watcher.refresh({
      broadcast,
      space,
      snapshot,
      lastProjects: snapshot.projects,
      lastUntracked: [],
    });

    const step = messages.find(isStatus);
    const panel = messages.find((m) => m.type === "workspace.projects");
    assert.equal(step === undefined ? undefined : labelOf(step), "reading personality");
    assert.deepEqual(
      (panel as { personality?: { tone?: string } } | undefined)?.personality,
      { tone: "warm" },
    );
  });

  it("does not re-announce reading personality when the file returns after a deletion", async () => {
    // Reset deletes personality.json while the server stays up. Discovery then
    // restores it and already reports "reading personality" — the monitor must
    // not append a second copy of the same line.
    const { messages, broadcast, space } = collectMessages();
    let exists = true;
    let body = '{"tone":"dry","name":"Ada"}';
    const watcher = createPersonalityFileWatcher(
      () => {},
      {
        personalityConfigExists: mock.fn(async () => exists),
        personalityConfigPath: () =>
          "/workspace/overseer-personality/personality.json",
        personalityDir: () => "/workspace/overseer-personality",
        readPersonality: mock.fn(async () => ({
          applied: { tone: "neutral", name: "HUMAN" },
          rejected: [],
        })),
        readFile: mock.fn(async () => {
          if (!exists) throw new Error("ENOENT");
          return body;
        }),
        recordAction: mock.fn(async () => {}),
        watchWithRetry: () => () => undefined,
      },
    );

    await watcher.refresh({
      broadcast,
      space,
      snapshot,
      lastProjects: snapshot.projects,
      lastUntracked: [],
    });

    exists = false;
    await watcher.refresh({
      broadcast,
      space,
      snapshot,
      lastProjects: snapshot.projects,
      lastUntracked: [],
    });
    messages.length = 0;

    exists = true;
    body = '{"tone":"neutral","name":"HUMAN"}';
    await watcher.refresh({
      broadcast,
      space,
      snapshot,
      lastProjects: snapshot.projects,
      lastUntracked: [],
    });

    assert.equal(
      messages.filter(
        (m) =>
          labelOf(m) === "reading personality",
      ).length,
      0,
    );
    const panel = messages.find((m) => m.type === "workspace.projects");
    assert.deepEqual(
      (panel as { personality?: { tone?: string; name?: string } } | undefined)
        ?.personality,
      { tone: "neutral", name: "HUMAN" },
    );
  });
});

describe("startWorkspaceMonitor coordinator", () => {
  it("reruns once when refresh overlaps", async () => {
    let refreshCalls = 0;
    let releaseFirst!: () => void;
    const firstRefresh = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let schedule!: () => void;

    const membership = {
      attach: mock.fn(),
      destroy: mock.fn(),
      getState: () => ({
        lastProjects: snapshot.projects,
        lastUntracked: [] as UntrackedFolder[],
      }),
      refresh: mock.fn(async () => {
        refreshCalls += 1;
        if (refreshCalls === 1) await firstRefresh;
      }),
    };
    const personality = {
      attach: mock.fn(),
      destroy: mock.fn(),
      refresh: mock.fn(async () => ({
        personalityMissing: false,
        justNoticedMissing: false,
      })),
    };

    const stop = startWorkspaceMonitor(() => {}, collectMessages().space, {
      readSnapshot: async () => snapshot,
      createMembership: (sched) => {
        schedule = sched;
        return membership;
      },
      createPersonality: () => personality,
      debounceMs: 1,
      pollMs: 60_000,
    });

    schedule();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(refreshCalls, 1);

    schedule();
    await new Promise((resolve) => setTimeout(resolve, 5));
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.equal(refreshCalls, 2);
    stop();
    assert.equal(membership.destroy.mock.calls.length, 1);
    assert.equal(personality.destroy.mock.calls.length, 1);
  });

  it("runs personality refresh before membership refresh", async () => {
    const order: string[] = [];
    let schedule!: () => void;
    const membership = {
      attach: () => {},
      destroy: () => {},
      getState: () => ({
        lastProjects: snapshot.projects,
        lastUntracked: [] as UntrackedFolder[],
      }),
      refresh: mock.fn(async () => {
        order.push("membership");
      }),
    };
    const personality = {
      attach: () => {},
      destroy: () => {},
      refresh: mock.fn(async () => {
        order.push("personality");
        return { personalityMissing: false, justNoticedMissing: false };
      }),
    };

    const stop = startWorkspaceMonitor(() => {}, collectMessages().space, {
      readSnapshot: async () => snapshot,
      createMembership: (sched) => {
        schedule = sched;
        return membership;
      },
      createPersonality: () => personality,
      debounceMs: 1,
      pollMs: 60_000,
    });

    schedule();
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.deepEqual(order, ["personality", "membership"]);
    stop();
  });

  it("keeps a forced schedule that lands mid-refresh", async () => {
    const forces: (boolean | undefined)[] = [];
    let schedule!: (force?: boolean) => void;
    let releaseFirst!: () => void;
    const firstRefresh = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const membership = {
      attach: () => {},
      destroy: () => {},
      getState: () => ({
        lastProjects: snapshot.projects,
        lastUntracked: [] as UntrackedFolder[],
      }),
      refresh: mock.fn(async (ctx: { force?: boolean }) => {
        forces.push(ctx.force);
        if (forces.length === 1) await firstRefresh;
      }),
    };
    const personality = {
      attach: () => {},
      destroy: () => {},
      refresh: mock.fn(async () => ({
        personalityMissing: false,
        justNoticedMissing: false,
      })),
    };

    const stop = startWorkspaceMonitor(() => {}, collectMessages().space, {
      readSnapshot: async () => snapshot,
      createMembership: (sched) => {
        schedule = sched;
        return membership;
      },
      createPersonality: () => personality,
      debounceMs: 1,
      pollMs: 60_000,
    });

    // Unforced tick starts and blocks; the watcher's forced tick arrives while
    // it is still running and must not be swallowed by the coalescing.
    schedule();
    await new Promise((resolve) => setTimeout(resolve, 5));
    schedule(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.deepEqual(forces, [false, true]);
    stop();
  });
});
