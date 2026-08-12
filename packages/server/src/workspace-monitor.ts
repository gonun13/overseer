import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
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
import {
  PERSONALITY_PROJECT,
  personalityConfigExists,
  personalityConfigPath,
  personalityDir,
  readPersonality,
} from "./memory/personality.js";
import {
  WORKSPACE_ROOT,
  scanWorkspace,
  withGitMeta,
} from "./workspace.js";

/**
 * Supervisor worker: keep the project list honest while the process is up.
 *
 * Discovery is a one-shot pass; this is the continuous half — create/delete
 * (and "became a git project" / "stopped being one") under the workspace root
 * update every connected client without replaying the wizard. Diffs also land
 * as `overseer.step` lines so the operations window reports what changed.
 * `personality.json` is tracked directly: edits are re-read live; deletion
 * complains and asks for a restart (discovery restores defaults on the next
 * boot — no silent live repair).
 *
 * Root-only `fs.watch` plus a slow poll: bind mounts (Docker Desktop) miss
 * events, and a clone creates the directory before `.git` exists, so a single
 * event is not enough — a debounced full `scanWorkspace` is the source of truth
 * for membership. A dedicated watch on `personality.json` covers nested edits
 * the root watcher cannot see. Git branch/dirtiness is refreshed on every poll
 * via the instance `git` CLI even when membership is unchanged.
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

/** Branch and dirtiness only — path membership is `scanKey`'s job. */
function gitMetaKey(projects: DiscoveredProject[]): string {
  return projects
    .map(
      (p) =>
        `${p.path}\t${p.gitBranch ?? "?"}\t${p.dirty === undefined ? "?" : p.dirty ? "1" : "0"}`,
    )
    .join("\0");
}

/** Content fingerprint for live `personality.json` tracking. */
async function personalityFingerprint(): Promise<string | null> {
  try {
    return await readFile(personalityConfigPath(), "utf8");
  } catch {
    return null;
  }
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

export function startWorkspaceMonitor(broadcast: Broadcast): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let polling: ReturnType<typeof setInterval> | null = null;
  let watcher: FSWatcher | undefined;
  let running = false;
  let lastKey = "";
  let lastProjects: DiscoveredProject[] = [];
  let lastUntracked: UntrackedFolder[] = [];
  /** Complain once per absence — every poll must not re-fire the same step. */
  let personalityMissingAnnounced = false;
  /** Last seen `personality.json` body; null means missing or not seeded. */
  let lastPersonalityBody: string | null | undefined;
  let personalityWatcher: FSWatcher | undefined;

  const attachPersonalityWatcher = () => {
    try {
      personalityWatcher?.close();
      personalityWatcher = undefined;
      const config = personalityConfigPath();
      personalityWatcher = watch(config, { persistent: true }, () => {
        schedule();
      });
      personalityWatcher.on("error", () => {
        // File deleted or mount flapped — retry after a beat.
        setTimeout(attachPersonalityWatcher, 2_000);
      });
    } catch {
      // Config absent: watch the project dir (or workspace) for its return.
      try {
        personalityWatcher?.close();
        const target = personalityDir();
        personalityWatcher = watch(target, { persistent: true }, (_e, name) => {
          if (name === "personality.json" || name == null) schedule();
        });
        personalityWatcher.on("error", () => {
          setTimeout(attachPersonalityWatcher, 2_000);
        });
      } catch {
        setTimeout(attachPersonalityWatcher, 2_000);
      }
    }
  };

  const refresh = async () => {
    if (running) return;
    running = true;
    try {
      // Quiet until discovery has written a snapshot — mid-wizard clients
      // should not learn of projects before the workspace step unlocks them.
      const snapshot = await readSnapshot();
      if (!snapshot) return;

      // Track personality.json itself — the directory can survive a config
      // delete. Deletion is reported; the operator restarts; discovery restores.
      const personalityMissing = !(await personalityConfigExists());
      const justNoticedMissing =
        personalityMissing && !personalityMissingAnnounced;
      if (justNoticedMissing) {
        personalityMissingAnnounced = true;
        lastPersonalityBody = null;
        broadcast({
          type: "overseer.step",
          id: randomUUID(),
          label: "personality deleted",
          outcome: "blocked",
          detail: "restart to restore",
        });
        await recordAction({
          actor: "overseer",
          action: "personality:missing",
          outcome: "blocked",
          detail: `${personalityConfigPath()} · deleted · restart to restore`,
        });
        attachPersonalityWatcher();
      } else if (!personalityMissing) {
        if (personalityMissingAnnounced) {
          personalityMissingAnnounced = false;
          attachPersonalityWatcher();
        }
      }

      // Live re-read when the config body changes (edits on the host / in a
      // session). Seed on first sight so discovery's applied fields are not
      // re-broadcast as a change.
      if (!personalityMissing) {
        const body = await personalityFingerprint();
        if (lastPersonalityBody === undefined) {
          lastPersonalityBody = body;
        } else if (body !== lastPersonalityBody) {
          lastPersonalityBody = body;
          const result = await readPersonality(WORKSPACE_ROOT, {
            scaffold: false,
          });
          broadcast({
            type: "overseer.step",
            id: randomUUID(),
            label: "reading personality",
            outcome: result.rejected.length > 0 ? "blocked" : "ok",
            detail:
              result.rejected.length > 0
                ? `${result.rejected.length} customization(s) refused`
                : Object.keys(result.applied).length > 0
                  ? `${Object.keys(result.applied).length} customization(s) applied`
                  : "no customizations set",
          });
          await recordAction({
            actor: "overseer",
            action: "personality:reread",
            outcome: result.rejected.length > 0 ? "blocked" : "ok",
            detail: personalityConfigPath(),
          });
          // Projects list unchanged — push personality/rejected only.
          broadcast({
            type: "workspace.projects",
            projects: lastProjects.length > 0 ? lastProjects : snapshot.projects,
            untrackedFolders: lastUntracked,
            personality: result.applied,
            rejected: result.rejected,
          });
        }
      }

      // Change test first, on a listing that costs a readdir and a stat per
      // entry. Path membership is cheap; git meta is a separate probe because
      // `status --porcelain` walks each tree and branch checkouts do not move
      // the path key.
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

      if (key === lastKey && !justNoticedMissing) {
        if (personalityMissing) return; // Client already has the sticky signal.
        // Same projects: refresh branch/dirtiness via the instance `git` CLI
        // and push only when meta moved. No operations lines — a checkout is
        // not a project appearing or vanishing.
        const projects = await withGitMeta(lastProjects);
        if (gitMetaKey(projects) === gitMetaKey(lastProjects)) return;
        lastProjects = projects;
        await syncSnapshotProjects(projects);
        broadcast({
          type: "workspace.projects",
          projects,
          untrackedFolders: lastUntracked,
        });
        return;
      }

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
      // When the whole personality project vanished, the missing complaint
      // already covers it — skip a redundant "removing project" line.
      const personalityPath = personalityDir();
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
  attachPersonalityWatcher();
  polling = setInterval(schedule, POLL_MS);

  return () => {
    if (timer !== null) clearTimeout(timer);
    if (polling !== null) clearInterval(polling);
    watcher?.close();
    personalityWatcher?.close();
  };
}
