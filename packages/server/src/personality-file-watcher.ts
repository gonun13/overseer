import { watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type {
  DiscoveredProject,
  ServerMessage,
  UntrackedFolder,
} from "@overseer/protocol";
import type { WorldSnapshot } from "./memory/internal.js";
import { recordAction } from "./memory/internal.js";
import {
  personalityConfigExists,
  personalityConfigPath,
  personalityDir,
  readPersonality,
} from "./memory/personality/api.js";
import { closeWatcher, watchWithRetry } from "./fs-watch.js";
import { WORKSPACE_ROOT } from "./workspace.js";

type Broadcast = (message: ServerMessage) => void;

export interface PersonalityRefreshContext {
  broadcast: Broadcast;
  snapshot: WorldSnapshot;
  lastProjects: DiscoveredProject[];
  lastUntracked: UntrackedFolder[];
}

export interface PersonalityRefreshResult {
  personalityMissing: boolean;
  justNoticedMissing: boolean;
}

export interface PersonalityFileWatcherDeps {
  personalityConfigExists: typeof personalityConfigExists;
  personalityConfigPath: typeof personalityConfigPath;
  personalityDir: typeof personalityDir;
  readPersonality: typeof readPersonality;
  readFile: typeof readFile;
  recordAction: typeof recordAction;
  watchWithRetry: typeof watchWithRetry;
}

const defaultDeps: PersonalityFileWatcherDeps = {
  personalityConfigExists,
  personalityConfigPath,
  personalityDir,
  readPersonality,
  readFile,
  recordAction,
  watchWithRetry,
};

/**
 * Set while `memory.reset` is erasing `personality.json` on purpose.
 *
 * The watcher otherwise treats every absence as an accident — "personality
 * deleted · restart to restore" — which is wrong in the middle of a wipe the
 * operator just confirmed. The reset step already reports the delete.
 */
let intentionalPersonalityDelete = false;

/** Call before an intentional wipe of `personality.json`; pair with `end`. */
export function beginIntentionalPersonalityDelete(): void {
  intentionalPersonalityDelete = true;
}

export function endIntentionalPersonalityDelete(): void {
  intentionalPersonalityDelete = false;
}

/** Content fingerprint for live `personality.json` tracking. */
async function personalityFingerprint(
  readFileFn: typeof readFile,
  configPath: string,
): Promise<string | null> {
  try {
    return await readFileFn(configPath, "utf8");
  } catch {
    return null;
  }
}

export function createPersonalityFileWatcher(
  schedule: () => void,
  deps: Partial<PersonalityFileWatcherDeps> = {},
): {
  attach: () => void;
  refresh: (ctx: PersonalityRefreshContext) => Promise<PersonalityRefreshResult>;
  destroy: () => void;
} {
  const d = { ...defaultDeps, ...deps };
  let getWatcher: (() => FSWatcher | undefined) | undefined;
  /** Complain once per absence — every poll must not re-fire the same step. */
  let personalityMissingAnnounced = false;
  /** Last seen `personality.json` body; null means missing or not seeded. */
  let lastPersonalityBody: string | null | undefined;

  const attachPersonalityWatcher = () => {
    try {
      const config = d.personalityConfigPath();
      getWatcher = d.watchWithRetry(() =>
        watch(config, { persistent: true }, () => {
          schedule();
        }),
      );
    } catch {
      // Config absent: watch the project dir (or workspace) for its return.
      try {
        const target = d.personalityDir();
        getWatcher = d.watchWithRetry(() =>
          watch(target, { persistent: true }, (_e, name) => {
            if (name === "personality.json" || name == null) schedule();
          }),
        );
      } catch {
        setTimeout(attachPersonalityWatcher, 2_000);
      }
    }
  };

  const refresh = async (
    ctx: PersonalityRefreshContext,
  ): Promise<PersonalityRefreshResult> => {
    const { broadcast, snapshot, lastProjects, lastUntracked } = ctx;

    const personalityMissing = !(await d.personalityConfigExists());
    const justNoticedMissing =
      personalityMissing && !personalityMissingAnnounced;

    if (justNoticedMissing) {
      personalityMissingAnnounced = true;
      lastPersonalityBody = null;
      attachPersonalityWatcher();
      // An intentional wipe already has its own operations line. Complaining
      // here would show as a second, failed "personality deleted" under the
      // reset that just succeeded.
      if (!intentionalPersonalityDelete) {
        broadcast({
          type: "overseer.step",
          id: randomUUID(),
          label: "personality deleted",
          outcome: "blocked",
          detail: "restart to restore",
        });
        await d.recordAction({
          actor: "overseer",
          action: "personality:missing",
          outcome: "blocked",
          detail: `${d.personalityConfigPath()} · deleted · restart to restore`,
        });
      }
    } else if (!personalityMissing) {
      if (personalityMissingAnnounced) {
        personalityMissingAnnounced = false;
        attachPersonalityWatcher();
        // The file is back — discovery already reported the restore (or the
        // operator put it back). Seed the fingerprint and push applied fields
        // quietly; another "reading personality" step would duplicate the
        // discovery line the operator just watched.
        lastPersonalityBody = await personalityFingerprint(
          d.readFile,
          d.personalityConfigPath(),
        );
        if (lastPersonalityBody !== null) {
          const result = await d.readPersonality(WORKSPACE_ROOT, {
            scaffold: false,
          });
          broadcast({
            type: "workspace.projects",
            projects:
              lastProjects.length > 0 ? lastProjects : snapshot.projects,
            untrackedFolders: lastUntracked,
            personality: result.applied,
            rejected: result.rejected,
          });
        }
        return { personalityMissing, justNoticedMissing };
      }
    }

    if (!personalityMissing) {
      const body = await personalityFingerprint(
        d.readFile,
        d.personalityConfigPath(),
      );
      if (lastPersonalityBody === undefined) {
        lastPersonalityBody = body;
      } else if (body !== lastPersonalityBody) {
        lastPersonalityBody = body;
        const result = await d.readPersonality(WORKSPACE_ROOT, {
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
        await d.recordAction({
          actor: "overseer",
          action: "personality:reread",
          outcome: result.rejected.length > 0 ? "blocked" : "ok",
          detail: d.personalityConfigPath(),
        });
        broadcast({
          type: "workspace.projects",
          projects: lastProjects.length > 0 ? lastProjects : snapshot.projects,
          untrackedFolders: lastUntracked,
          personality: result.applied,
          rejected: result.rejected,
        });
      }
    }

    return { personalityMissing, justNoticedMissing };
  };

  return {
    attach: attachPersonalityWatcher,
    refresh,
    destroy: () => {
      closeWatcher(getWatcher?.());
      getWatcher = undefined;
    },
  };
}
