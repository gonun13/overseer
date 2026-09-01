import { watch } from "node:fs";
import type { AgentAdapter } from "@overseer/protocol";
import { getAdapter } from "./adapters.js";
import { watchWithRetry, closeWatcher } from "./fs-watch.js";
import { readSnapshot } from "./memory/internal.js";

/**
 * Watches the attached provider's transcript directory and refreshes the
 * sessions list when something the app did not start appears in it.
 *
 * Without this, a session only reaches the list on a socket connect, a project
 * switch, or a provider connect — so a run started outside the app (a dev loop,
 * a raw console, a `claude` in a host terminal sharing the auth volume) stayed
 * invisible until the operator happened to switch project. The app's own
 * sessions never needed it: the supervisor pushes the list when it creates,
 * closes, or deletes one.
 *
 * Which directory to watch comes from the adapter (`sessionsWatchPath`), never
 * from a path this module assumes — where a CLI keeps its state is the
 * adapter's business.
 */

/**
 * Longer than the workspace monitor's 400ms, and deliberately so. A transcript
 * is appended continuously for the whole of a streaming turn, and every refresh
 * re-reads each transcript in the project to rebuild the list. Because the
 * debounce is trailing, a dense burst of writes never fires it — the refresh
 * lands once the turn goes quiet, which is exactly when the list is worth
 * rebuilding.
 */
const DEBOUNCE_MS = 1_500;
/** Safety net for a host FS that drops inotify/fsevents, as on a bind mount.
 * Long, because this is a fallback for a watcher that usually works, and each
 * tick costs a full list rebuild. */
const POLL_MS = 15_000;

export interface TranscriptMonitorDeps {
  readSnapshot?: typeof readSnapshot;
  getAdapter?: (id: string) => AgentAdapter | undefined;
  /** Seam for tests — returns a closable watcher for `dir`. */
  watchDir?: (dir: string, onChange: (filename: string | null) => void) => {
    close: () => void;
  };
  debounceMs?: number;
  pollMs?: number;
}

function defaultWatchDir(
  dir: string,
  onChange: (filename: string | null) => void,
): { close: () => void } {
  const get = watchWithRetry(
    () =>
      watch(dir, { recursive: true }, (_event, filename) => {
        onChange(typeof filename === "string" ? filename : null);
      }),
    (error) => {
      console.error("overseer: transcript watch failed", error);
    },
  );
  return { close: () => closeWatcher(get()) };
}

/**
 * `refresh` is the supervisor's `list()` — it broadcasts on its own, so this
 * monitor never touches the wire itself.
 */
export function startTranscriptMonitor(
  refresh: () => void | Promise<unknown>,
  deps: TranscriptMonitorDeps = {},
): () => void {
  const readSnapshotFn = deps.readSnapshot ?? readSnapshot;
  const getAdapterFn = deps.getAdapter ?? getAdapter;
  const watchDirFn = deps.watchDir ?? defaultWatchDir;
  const debounceMs = deps.debounceMs ?? DEBOUNCE_MS;
  const pollMs = deps.pollMs ?? POLL_MS;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let polling: ReturnType<typeof setInterval> | null = null;
  let watcher: { close: () => void } | undefined;
  let watchedDir: string | undefined;
  let running = false;
  let pending = false;

  const runRefresh = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      do {
        pending = false;
        await refresh();
      } while (pending);
    } catch (error) {
      console.error("overseer: transcript monitor refresh failed", error);
    } finally {
      running = false;
    }
  };

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void runRefresh();
    }, debounceMs);
  };

  /**
   * Attach to whatever the currently attached provider writes. Re-checked on
   * every poll because the provider can be swapped, or attached for the first
   * time, long after the server started.
   */
  const attach = async () => {
    let dir: string | undefined;
    try {
      const snapshot = await readSnapshotFn();
      const providerId = snapshot?.attached_provider;
      if (providerId !== undefined) {
        dir = getAdapterFn(providerId)?.sessionsWatchPath?.();
      }
    } catch {
      // No snapshot yet — try again on the next tick.
      return;
    }
    if (dir === undefined || dir === watchedDir) return;
    watcher?.close();
    watchedDir = dir;
    watcher = watchDirFn(dir, (filename) => {
      // Transcripts only. The directory also carries `sessions-index.json` and
      // per-project `memory/`, which churn without changing the session list.
      if (filename !== null && !filename.endsWith(".jsonl")) return;
      schedule();
    });
  };

  void attach();
  polling = setInterval(() => {
    void attach();
    schedule();
  }, pollMs);

  return () => {
    if (timer !== null) clearTimeout(timer);
    if (polling !== null) clearInterval(polling);
    watcher?.close();
    watcher = undefined;
    watchedDir = undefined;
  };
}
