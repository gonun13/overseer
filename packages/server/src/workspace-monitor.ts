import type { ServerMessage } from "@overseer/protocol";
import { readSnapshot } from "./memory/internal.js";
import { createPersonalityFileWatcher } from "./personality-file-watcher.js";
import { createWorkspaceMembershipWorker } from "./workspace-membership-worker.js";

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
 * the root watcher cannot see. Git branch/dirtiness rides the same tick — one
 * scan feeds both — but the probes themselves are gated in `git-probe.ts`, so
 * an idle workspace costs stats rather than a `git` process per project. A
 * watcher-driven tick passes `force` to lift the dirtiness floor.
 */

const DEBOUNCE_MS = 400;
/** Safety net when the host FS silently drops inotify/fsevents. Affordable at
 * this interval only because the tick costs a readdir and a stat per entry —
 * see the change test in `refresh`. */
const POLL_MS = 5_000;

type Broadcast = (message: ServerMessage) => void;

export interface WorkspaceMonitorDeps {
  readSnapshot?: typeof readSnapshot;
  createMembership?: typeof createWorkspaceMembershipWorker;
  createPersonality?: typeof createPersonalityFileWatcher;
  debounceMs?: number;
  pollMs?: number;
}

export function startWorkspaceMonitor(
  broadcast: Broadcast,
  deps: WorkspaceMonitorDeps = {},
): () => void {
  const readSnapshotFn = deps.readSnapshot ?? readSnapshot;
  const createMembershipFn =
    deps.createMembership ?? createWorkspaceMembershipWorker;
  const createPersonalityFn =
    deps.createPersonality ?? createPersonalityFileWatcher;
  const debounceMs = deps.debounceMs ?? DEBOUNCE_MS;
  const pollMs = deps.pollMs ?? POLL_MS;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let polling: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let pending = false;
  /** Sticky: a forced schedule that lands mid-refresh must still reach the
   * next pass rather than being swallowed by the coalescing above. */
  let pendingForce = false;

  const schedule = (force = false) => {
    if (force) pendingForce = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, debounceMs);
  };

  const membership = createMembershipFn(schedule);
  const personality = createPersonalityFn(schedule);

  const refresh = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      do {
        pending = false;
        const force = pendingForce;
        pendingForce = false;
        const snapshot = await readSnapshotFn();
        if (!snapshot) {
          // Nothing was refreshed, so the force has not been spent yet.
          pendingForce ||= force;
          continue;
        }

        const state = membership.getState();
        const personalityResult = await personality.refresh({
          broadcast,
          snapshot,
          lastProjects: state.lastProjects,
          lastUntracked: state.lastUntracked,
        });

        await membership.refresh({
          broadcast,
          snapshot,
          personalityMissing: personalityResult.personalityMissing,
          justNoticedMissing: personalityResult.justNoticedMissing,
          force,
        });
      } while (pending);
    } catch (error) {
      console.error("overseer: workspace monitor failed", error);
    } finally {
      running = false;
    }
  };

  membership.attach();
  personality.attach();
  polling = setInterval(schedule, pollMs);

  return () => {
    if (timer !== null) clearTimeout(timer);
    if (polling !== null) clearInterval(polling);
    membership.destroy();
    personality.destroy();
  };
}
