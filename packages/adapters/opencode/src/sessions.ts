import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AdapterSessionStore, SessionMeta } from "@overseer/protocol";
import type { CliRunner } from "./cli.js";
import { type ServeFactory, withServe } from "./serve.js";

/**
 * opencode keeps every session of every project in one SQLite database under
 * its data directory — captured against the pinned 1.19.4, not published:
 *
 *   $XDG_DATA_HOME/opencode/opencode.db   (default ~/.local/share/opencode)
 *     session(id 'ses_…', directory, parent_id, title, time_created,
 *             time_updated, time_archived, …)
 *
 * Reads go straight to that file, read-only: the list is rebuilt on every
 * transcript change, and `opencode session list` costs half a second per
 * project. Writes never do — creating goes through `opencode serve` and
 * deleting through `opencode session delete`, so the CLI keeps its own
 * messages, parts and project rows consistent.
 *
 * Child sessions (`parent_id` set) are a subagent's, not the operator's, and
 * archived ones are hidden by the CLI itself; neither is listed.
 */

/** The title opencode gives a session before its first message names it. */
const PLACEHOLDER_TITLE = /^(New|Child) session - \d{4}-\d{2}-\d{2}T/;
const SESSION_ID = /^ses_[A-Za-z0-9]+$/;

export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(
    env.XDG_DATA_HOME || path.join(env.HOME || homedir(), ".local", "share"),
    "opencode",
  );
}

export function dbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENCODE_DB || path.join(dataDir(env), "opencode.db");
}

/** A change under `dataDir` that can change the list: the database or its
 * write-ahead log, never the CLI's own logs beside them. */
export function isSessionsChange(filename: string): boolean {
  return /^opencode\.db(-wal)?$/.test(path.basename(filename));
}

interface Row {
  id: string;
  title: string;
  directory: string;
  time_created: number;
  time_updated: number;
}

export function title(row: Pick<Row, "title">): string | undefined {
  const text = row.title.replace(/\s+/g, " ").trim();
  return text === "" || PLACEHOLDER_TITLE.test(text)
    ? undefined
    : text.slice(0, 160);
}

function meta(row: Row): SessionMeta {
  const name = title(row);
  return {
    id: row.id,
    adapterId: "opencode",
    projectDir: row.directory,
    ...(name !== undefined ? { name } : {}),
    status: "dormant",
    createdAt: new Date(row.time_created).toISOString(),
    lastActiveAt: new Date(row.time_updated).toISOString(),
    // The CLI's per-session cost is its own estimate from list prices, not
    // what the operator's plan was charged.
    totalCostUsd: 0,
  };
}

const COLUMNS = "id, title, directory, time_created, time_updated";
const OPERATOR_SESSION = "parent_id IS NULL AND time_archived IS NULL";

function query<T>(file: string, run: (db: DatabaseSync) => T, empty: T): T {
  // No database yet is a CLI that has never run: nothing to list.
  if (!existsSync(file)) return empty;
  const db = new DatabaseSync(file, { readOnly: true, timeout: 2_000 });
  try {
    return run(db);
  } finally {
    db.close();
  }
}

export function readProjectSessions(
  file: string,
  projectDir: string,
): SessionMeta[] {
  return query(
    file,
    (db) =>
      (
        db
          .prepare(
            `SELECT ${COLUMNS} FROM session WHERE directory = ? AND ${OPERATOR_SESSION} ORDER BY time_updated DESC`,
          )
          .all(projectDir) as unknown as Row[]
      ).map(meta),
    [],
  );
}

function readSession(
  file: string,
  projectDir: string,
  sessionId: string,
): Row | undefined {
  return query(
    file,
    (db) =>
      db
        .prepare(
          `SELECT ${COLUMNS} FROM session WHERE id = ? AND directory = ? AND ${OPERATOR_SESSION}`,
        )
        .get(sessionId, projectDir) as unknown as Row | undefined,
    undefined,
  );
}

export function sessionStore(deps: {
  serve: ServeFactory;
  cli: CliRunner;
  env?: NodeJS.ProcessEnv;
}): AdapterSessionStore {
  const file = () => dbPath(deps.env);

  const deleteSession = async (
    projectDir: string,
    sessionId: string,
  ): Promise<void> => {
    // Idempotent, and never a delete of another project's session: an id this
    // project does not own — a loop lease of another provider's, one already
    // gone — is not an error and starts no CLI.
    if (readSession(file(), projectDir, sessionId) === undefined) return;
    const result = await deps.cli(["session", "delete", sessionId], {
      cwd: projectDir,
      timeoutMs: 15_000,
    });
    if (
      result.code !== 0 &&
      !/session not found/i.test(result.stdout + result.stderr)
    )
      throw new Error("opencode could not delete the session");
  };

  return {
    async listProjectSessions(projectDir) {
      return readProjectSessions(file(), projectDir);
    },
    // opencode has no flag to adopt an id, so the session is created first,
    // empty, and the TUI is opened on it with `--session`. It is titled by the
    // CLI itself from the first message, as any session it starts is.
    async mintSessionId({ projectDir }) {
      return createSession(deps.serve, projectDir);
    },
    async discardPreparedSession(projectDir, sessionId) {
      await deleteSession(projectDir, sessionId);
    },
    async lookupSessionTitle(projectDir, sessionId) {
      const row = readSession(file(), projectDir, sessionId);
      return row !== undefined ? title(row) : undefined;
    },
    deleteSession,
  };
}

/** Create one empty session in `projectDir` and return its id. Shared with
 * the dev loop's bundle, which opens its own session the same way. */
export async function createSession(
  serve: ServeFactory,
  projectDir: string,
): Promise<string> {
  return withServe(serve, projectDir, async (client) => {
    const session = await client.request<{ id?: unknown; directory?: unknown }>(
      "POST",
      "/session",
      { query: { directory: projectDir }, body: {} },
    );
    if (
      typeof session?.id !== "string" ||
      !SESSION_ID.test(session.id) ||
      session.directory !== projectDir
    )
      throw new Error("opencode did not create a session");
    return session.id;
  });
}
