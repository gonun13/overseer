import { watch, type FSWatcher } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  DiscoveredProject,
  ServerMessage,
  UntrackedFolder,
} from "@overseer/protocol";
import type { WorldSnapshot } from "./memory/internal.js";
import { recordAction, syncSnapshotProjects } from "./memory/internal.js";
import {
  PERSONALITY_PROJECT,
  personalityDir,
} from "./memory/personality/api.js";
import { closeWatcher, watchWithRetry } from "./fs-watch.js";
import { gitProbe, type ProbeEvent } from "./vcs/index.js";
import { WORKSPACE_ROOT, scanWorkspace } from "./workspace.js";

type Broadcast = (message: ServerMessage) => void;

export interface MembershipRefreshContext {
  broadcast: Broadcast;
  snapshot: WorldSnapshot;
  personalityMissing: boolean;
  justNoticedMissing: boolean;
  /** A watcher saw something move, so this tick pays for a dirtiness probe
   * the interval floor would otherwise skip. */
  force?: boolean;
}

export interface MembershipState {
  lastProjects: DiscoveredProject[];
  lastUntracked: UntrackedFolder[];
}

export interface WorkspaceMembershipWorkerDeps {
  scanWorkspace: typeof scanWorkspace;
  gitMeta: typeof gitProbe.readMany;
  forgetGit: typeof gitProbe.forget;
  takeProbeEvents: typeof gitProbe.takeEvents;
  syncSnapshotProjects: typeof syncSnapshotProjects;
  recordAction: typeof recordAction;
  personalityDir: typeof personalityDir;
  watchWithRetry: typeof watchWithRetry;
}

const defaultDeps: WorkspaceMembershipWorkerDeps = {
  scanWorkspace,
  gitMeta: (projects, opts) => gitProbe.readMany(projects, opts),
  forgetGit: (dir) => gitProbe.forget(dir),
  takeProbeEvents: () => gitProbe.takeEvents(),
  syncSnapshotProjects,
  recordAction,
  personalityDir,
  watchWithRetry,
};

function scanKey(
  projects: DiscoveredProject[],
  untracked: UntrackedFolder[],
): string {
  return [
    ...projects.map((p) => `p:${p.path}`),
    ...untracked.map((f) => `u:${f.path}`),
  ].join("\0");
}

/** Branch and dirtiness only — path membership is `scanKey`'s job. */
function gitMetaKey(projects: DiscoveredProject[]): string {
  return projects
    .map(
      (p) =>
        `${p.path}\t${p.gitBranch ?? "?"}\t${p.dirty === undefined ? "?" : p.dirty ? "1" : "0"}`,
    )
    .join("\0");
}

function fallbackActive(
  projects: DiscoveredProject[],
): string | undefined {
  return (
    projects.find((p) => p.name === PERSONALITY_PROJECT)?.path ??
    projects[0]?.path
  );
}

function emitProjectDiff(
  broadcast: Broadcast,
  before: DiscoveredProject[],
  after: DiscoveredProject[],
): void {
  const prev = new Map(before.map((p) => [p.path, p]));
  const next = new Map(after.map((p) => [p.path, p]));

  for (const [projectPath, project] of next) {
    if (prev.has(projectPath)) continue;
    broadcast({
      type: "overseer.step",
      id: randomUUID(),
      label: `adding project ${project.name}`,
      outcome: "ok",
      detail: projectPath,
    });
  }
  for (const [projectPath, project] of prev) {
    if (next.has(projectPath)) continue;
    broadcast({
      type: "overseer.step",
      id: randomUUID(),
      label: `removing project ${project.name}`,
      outcome: "ok",
      detail: projectPath,
    });
  }
}

function emitUntrackedDiff(
  broadcast: Broadcast,
  before: UntrackedFolder[],
  after: UntrackedFolder[],
): void {
  const prev = new Map(before.map((f) => [f.path, f]));
  const next = new Map(after.map((f) => [f.path, f]));

  for (const [, folder] of next) {
    if (prev.has(folder.path)) continue;
    broadcast({
      type: "overseer.step",
      id: randomUUID(),
      label: `noticing folder ${folder.name}`,
      outcome: "blocked",
      detail: "not a git project",
    });
  }
  for (const [folderPath, folder] of prev) {
    if (next.has(folderPath)) continue;
    broadcast({
      type: "overseer.step",
      id: randomUUID(),
      label: `folder ${folder.name} cleared`,
      outcome: "ok",
      detail: folderPath,
    });
  }
}

/**
 * A stalled or failed git probe is an operations line, not just a log line:
 * the operator watching a branch go stale deserves to be told the mount is
 * slow rather than left guessing. `git-probe.ts` has already deduped these —
 * one per directory per state change.
 */
function emitProbeEvents(broadcast: Broadcast, events: ProbeEvent[]): void {
  for (const event of events) {
    const name = event.dir.split("/").pop() ?? event.dir;
    if (event.kind === "recovered") {
      broadcast({
        type: "overseer.step",
        id: randomUUID(),
        label: `git reading ${name} again`,
        outcome: "ok",
        detail: event.dir,
      });
      continue;
    }
    broadcast({
      type: "overseer.step",
      id: randomUUID(),
      label:
        event.kind === "slow"
          ? `git slow in ${name}`
          : `git probe ${event.kind} in ${name}`,
      outcome: event.kind === "slow" ? "ok" : "blocked",
      detail: `${event.command} · ${event.detail ?? `${Math.round(event.ms)}ms`}`,
    });
  }
}

export function createWorkspaceMembershipWorker(
  schedule: (force?: boolean) => void,
  deps: Partial<WorkspaceMembershipWorkerDeps> = {},
): {
  attach: () => void;
  refresh: (ctx: MembershipRefreshContext) => Promise<void>;
  getState: () => MembershipState;
  destroy: () => void;
} {
  const d = { ...defaultDeps, ...deps };
  let getWatcher: (() => FSWatcher | undefined) | undefined;
  let lastKey = "";
  let lastProjects: DiscoveredProject[] = [];
  let lastUntracked: UntrackedFolder[] = [];

  const attachRootWatcher = () => {
    getWatcher = d.watchWithRetry(
      () =>
        watch(WORKSPACE_ROOT, { persistent: true }, (_event, name) => {
          if (typeof name === "string" && name.startsWith("_")) return;
          // Something under the root moved: worth a dirtiness probe now
          // rather than at the next interval floor.
          schedule(true);
        }),
      (error) => {
        console.error("overseer: workspace watch error", error);
      },
    );
  };

  const refresh = async (ctx: MembershipRefreshContext): Promise<void> => {
    const { broadcast, snapshot, personalityMissing, justNoticedMissing } =
      ctx;

    // One readdir per tick, and the git meta is filled onto its result — the
    // membership-changed path used to scan the root a second time (probing
    // git inline) on top of this one.
    const listing = await d.scanWorkspace(WORKSPACE_ROOT, { git: false });
    const key = scanKey(listing.projects, listing.untracked);

    if (lastKey === "") {
      lastProjects = snapshot.projects;
      lastUntracked = [];
      lastKey = scanKey(lastProjects, lastUntracked);
    }

    const changed = key !== lastKey;
    const projects = await d.gitMeta(listing.projects, {
      force: changed || ctx.force === true,
    });
    emitProbeEvents(broadcast, d.takeProbeEvents());

    if (!changed && !justNoticedMissing) {
      if (personalityMissing) return;
      if (gitMetaKey(projects) === gitMetaKey(lastProjects)) return;
      lastProjects = projects;
      await d.syncSnapshotProjects(projects);
      broadcast({
        type: "workspace.projects",
        projects,
        untrackedFolders: lastUntracked,
      });
      return;
    }

    const untracked = listing.untracked;

    const previousProjects = lastProjects;
    const previousUntracked = lastUntracked;
    lastKey = scanKey(projects, untracked);
    lastProjects = projects;
    lastUntracked = untracked;

    // A project that left the workspace must not keep a cached branch alive.
    const stillListed = new Set(projects.map((p) => p.path));
    for (const project of previousProjects) {
      if (!stillListed.has(project.path)) d.forgetGit(project.path);
    }

    const previousActive = snapshot.last_active_project;
    const stillThere =
      previousActive === undefined ||
      projects.some((p) => p.path === previousActive);

    let activeProjectPath: string | undefined;
    if (!stillThere) {
      activeProjectPath = fallbackActive(projects);
      await d.syncSnapshotProjects(projects, { path: activeProjectPath });
      if (previousActive !== undefined) {
        await d.recordAction({
          actor: "overseer",
          action: "project:active-fallback",
          outcome: activeProjectPath !== undefined ? "ok" : "blocked",
          detail: activeProjectPath
            ? `${previousActive} gone → ${activeProjectPath}`
            : `${previousActive} gone · no projects left`,
        });
      }
    } else {
      await d.syncSnapshotProjects(projects);
    }

    await d.recordAction({
      actor: "overseer",
      action: "workspace:projects",
      outcome: "ok",
      detail: `${projects.length} project(s) · ${untracked.length} untracked`,
    });

    const personalityPath = d.personalityDir();
    const personalityProjectGone = !projects.some(
      (p) => p.path === personalityPath,
    );
    if (personalityMissing && personalityProjectGone) {
      emitProjectDiff(
        broadcast,
        previousProjects.filter((p) => p.path !== personalityPath),
        projects,
      );
    } else {
      emitProjectDiff(broadcast, previousProjects, projects);
    }
    emitUntrackedDiff(broadcast, previousUntracked, untracked);

    broadcast({
      type: "workspace.projects",
      projects,
      untrackedFolders: untracked,
      ...(!stillThere && activeProjectPath !== undefined
        ? { activeProjectPath }
        : {}),
      ...(personalityMissing
        ? { personality: {}, personalityMissing: true as const }
        : {}),
    });
  };

  return {
    attach: attachRootWatcher,
    refresh,
    getState: () => ({
      lastProjects,
      lastUntracked,
    }),
    destroy: () => {
      closeWatcher(getWatcher?.());
      getWatcher = undefined;
    },
  };
}

// Export pure helpers for unit tests.
export {
  scanKey,
  gitMetaKey,
  fallbackActive,
  emitProjectDiff,
  emitUntrackedDiff,
};
