import { execFile } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PROJECT_FOLDER_PATTERN } from "@overseer/protocol";
import { WORKSPACE_ROOT, scanWorkspace } from "./workspace.js";

const run = promisify(execFile);

/** Below this, a spammed retry loop cannot outrun a human reading the error
 * and stopping. Above it, an operator naming several projects in a row is
 * never made to wait. */
const CREATE_COOLDOWN_MS = 2_000;

/** A hard ceiling on what this endpoint alone can do to the workspace's
 * disk/inode budget, independent of request rate — the guard that survives a
 * process restart or a client that reconnects to dodge the cooldown. */
const MAX_PROJECTS = 500;

export interface CreateProjectInput {
  name: string;
  folder: string;
  description: string;
}

export type CreateProjectResult =
  | { ok: true; path: string }
  | { ok: false; reason: string; benign: boolean };

export interface CreateProjectDeps {
  root?: string;
  mkdir?: typeof mkdir;
  writeFile?: typeof writeFile;
  stat?: typeof stat;
  rm?: typeof rm;
  scanWorkspace?: typeof scanWorkspace;
  gitInit?: (dir: string) => Promise<void>;
  now?: () => number;
}

async function defaultGitInit(dir: string): Promise<void> {
  // -b main: don't inherit whatever init.defaultBranch happens to be, and
  // don't emit git's "using master" advice — same reasoning as
  // memory/personality/scaffold.ts's own `git init -q -b main`.
  await run("git", ["init", "-b", "main"], { cwd: dir, timeout: 5_000 });
}

/**
 * Builds one `createProject` function with its own private guard state
 * (single-flight lock, last-success timestamp). A factory rather than bare
 * module-level variables so tests can stand up an isolated instance instead
 * of sharing mutable state across cases — the same shape `workspace-
 * membership-worker.ts` uses for its own DI.
 *
 * Guard state is process-wide, not per-socket: this app is single-operator /
 * single-container (multiple tabs, not multiple tenants), matching the
 * existing process-wide single-flight convention discovery and login already
 * use, rather than inventing a per-connection one.
 */
export function createProjectCreator(
  deps: CreateProjectDeps = {},
): (input: CreateProjectInput) => Promise<CreateProjectResult> {
  const root = deps.root ?? WORKSPACE_ROOT;
  const doMkdir = deps.mkdir ?? mkdir;
  const doWrite = deps.writeFile ?? writeFile;
  const doStat = deps.stat ?? stat;
  const doRm = deps.rm ?? rm;
  const doScan = deps.scanWorkspace ?? scanWorkspace;
  const doGitInit = deps.gitInit ?? defaultGitInit;
  const now = deps.now ?? Date.now;

  let inFlight = false;
  let lastCreatedAt: number | undefined;

  return async function createProject(
    input: CreateProjectInput,
  ): Promise<CreateProjectResult> {
    if (inFlight) {
      return {
        ok: false,
        benign: true,
        reason: "a project is already being created",
      };
    }
    if (
      lastCreatedAt !== undefined &&
      now() - lastCreatedAt < CREATE_COOLDOWN_MS
    ) {
      return {
        ok: false,
        benign: true,
        reason: "creating projects too quickly — wait a moment",
      };
    }

    const name = input.name.trim();
    if (!name) {
      return { ok: false, benign: true, reason: "name cannot be empty" };
    }

    const folder = input.folder.trim();
    if (!PROJECT_FOLDER_PATTERN.test(folder)) {
      return {
        ok: false,
        benign: true,
        reason: "folder must be lowercase letters, numbers and hyphens",
      };
    }

    inFlight = true;
    try {
      const { projects } = await doScan(root, { git: false });
      if (projects.length >= MAX_PROJECTS) {
        return {
          ok: false,
          benign: true,
          reason: `workspace already has too many projects (${MAX_PROJECTS})`,
        };
      }

      // `folder` is regex-constrained to a single path segment of lowercase
      // alnum/hyphens — no separators, no `.`/`..` — so `path.join` cannot
      // leave `root`. `isInsideWorkspace` (workspace.ts) can't be used here:
      // it `realpath`s the candidate, and this one does not exist yet.
      const dir = path.join(root, folder);

      try {
        await doStat(dir);
        return {
          ok: false,
          benign: true,
          reason: `/workspace/${folder} already exists`,
        };
      } catch {
        // ENOENT is the success path — nothing there yet.
      }

      try {
        await doMkdir(dir);
      } catch (error) {
        return { ok: false, benign: false, reason: describe(error) };
      }

      try {
        await doGitInit(dir);
        const description = input.description.trim();
        const readme = description
          ? `# ${name}\n\n${description}\n`
          : `# ${name}\n`;
        await doWrite(path.join(dir, "README.md"), readme, "utf8");
      } catch (error) {
        // Half-created (mkdir succeeded, git init or the README write did
        // not) left behind for the operator to clean up by hand is worse
        // than a retry with the same name working.
        await doRm(dir, { recursive: true, force: true }).catch(() => {});
        return { ok: false, benign: false, reason: describe(error) };
      }

      lastCreatedAt = now();
      return { ok: true, path: dir };
    } finally {
      inFlight = false;
    }
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "project creation failed";
}

/** The instance `ws.ts` uses. */
export const createProject = createProjectCreator();
