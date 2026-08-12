import { watch, type FSWatcher } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  DiscoveredProject,
  ServerMessage,
  UntrackedFolder,
} from "@overseer/protocol";
import {
  readSnapshot,
  recordAction,
  syncSnapshotProjects,
} from "./memory/internal.js";
import { PERSONALITY_PROJECT } from "./memory/personality.js";
import { WORKSPACE_ROOT, scanWorkspace } from "./workspace.js";

/**
 * Supervisor worker: keep the project list honest while the process is up.
 *
 * Discovery is a one-shot pass; this is the continuous half — create/delete
 * (and "became a git project" / "stopped being one") under the workspace root
 * update every connected client without replaying the wizard. Diffs also land
 * as `overseer.step` lines so the operations window reports what changed.
 *
 * Root-only `fs.watch` plus a slow poll: bind mounts (Docker Desktop) miss
 * events, and a clone creates the directory before `.git` exists, so a single
 * event is not enough — a debounced full `scanWorkspace` is the source of truth.
 */

const DEBOUNCE_MS = 400;
/** Safety net when the host FS silently drops inotify/fsevents. Affordable at
 * this interval only because the tick costs a readdir and a stat per entry —
 * see the change test in `refresh`. */
const POLL_MS = 5_000;

type Broadcast = (message: ServerMessage) => void;

function scanKey(
  projects: DiscoveredProject[],
  untracked: UntrackedFolder[],
): string {
  return [
    ...projects.map((p) => `p:${p.path}`),
    ...untracked.map((f) => `u:${f.path}`),
  ].join("\0");
}

/** Prefer overseer-personality, else the first listed project. */
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

export function startWorkspaceMonitor(broadcast: Broadcast): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let polling: ReturnType<typeof setInterval> | null = null;
  let watcher: FSWatcher | undefined;
  let running = false;
  let lastKey = "";
  let lastProjects: DiscoveredProject[] = [];
  let lastUntracked: UntrackedFolder[] = [];

  const refresh = async () => {
    if (running) return;
    running = true;
    try {
      // Quiet until discovery has written a snapshot — mid-wizard clients
      // should not learn of projects before the workspace step unlocks them.
      const snapshot = await readSnapshot();
      if (!snapshot) return;

      // Change test first, on a listing that costs a readdir and a stat per
      // entry. `scanKey` reflects which paths exist and nothing else, so the
      // git state a full scan reads — `rev-parse` plus a `status --porcelain`
      // that walks the whole tree, per project — could never move the key, and
      // on every unchanged tick it was computed and dropped. Once a second,
      // forever, on a bind mount, for a result nobody read.
      const listing = await scanWorkspace(WORKSPACE_ROOT, { git: false });
      const key = scanKey(listing.projects, listing.untracked);

      // Seed against discovery's project list and an empty untracked set so a
      // pre-existing non-git folder is announced once after the wizard, and
      // discovery's own list is not re-broadcast as "adding project".
      if (lastKey === "") {
        lastProjects = snapshot.projects;
        lastUntracked = [];
        lastKey = scanKey(lastProjects, lastUntracked);
      }
      if (key === lastKey) return;

      // Something moved: now pay for branch and dirtiness, which the panel
      // renders for the list it is about to receive.
      const { projects, untracked } = await scanWorkspace();

      const previousProjects = lastProjects;
      const previousUntracked = lastUntracked;
      // From the full scan, not the listing: the two are a moment apart, and
      // remembering a key for a state that was never broadcast would skip the
      // tick that reports whatever landed in between.
      lastKey = scanKey(projects, untracked);
      lastProjects = projects;
      lastUntracked = untracked;

      const previousActive = snapshot.last_active_project;
      const stillThere =
        previousActive === undefined ||
        projects.some((p) => p.path === previousActive);

      let activeProjectPath: string | undefined;
      if (!stillThere) {
        activeProjectPath = fallbackActive(projects);
        await syncSnapshotProjects(projects, { path: activeProjectPath });
        if (previousActive !== undefined) {
          await recordAction({
            actor: "overseer",
            action: "project:active-fallback",
            outcome: activeProjectPath !== undefined ? "ok" : "blocked",
            detail: activeProjectPath
              ? `${previousActive} gone → ${activeProjectPath}`
              : `${previousActive} gone · no projects left`,
          });
        }
      } else {
        await syncSnapshotProjects(projects);
      }

      await recordAction({
        actor: "overseer",
        action: "workspace:projects",
        outcome: "ok",
        detail: `${projects.length} project(s) · ${untracked.length} untracked`,
      });

      // Operations lines first so the window can open before the panel updates.
      emitProjectDiff(broadcast, previousProjects, projects);
      emitUntrackedDiff(broadcast, previousUntracked, untracked);

      broadcast({
        type: "workspace.projects",
        projects,
        untrackedFolders: untracked,
        ...(!stillThere && activeProjectPath !== undefined
          ? { activeProjectPath }
          : {}),
      });
    } catch (error) {
      console.error("overseer: workspace monitor failed", error);
    } finally {
      running = false;
    }
  };

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, DEBOUNCE_MS);
  };

  const attachWatcher = () => {
    try {
      watcher?.close();
      watcher = watch(WORKSPACE_ROOT, { persistent: true }, (_event, name) => {
        // Ignore the overseer's own staging area noise when we can.
        if (typeof name === "string" && name.startsWith("_")) return;
        schedule();
      });
      watcher.on("error", (error) => {
        console.error("overseer: workspace watch error", error);
        // Remount after a beat — common when the bind mount flaps at boot.
        setTimeout(attachWatcher, 2_000);
      });
    } catch (error) {
      console.error(
        `overseer: cannot watch ${path.resolve(WORKSPACE_ROOT)}`,
        error,
      );
      setTimeout(attachWatcher, 2_000);
    }
  };

  attachWatcher();
  polling = setInterval(schedule, POLL_MS);

  return () => {
    if (timer !== null) clearTimeout(timer);
    if (polling !== null) clearInterval(polling);
    watcher?.close();
  };
}
