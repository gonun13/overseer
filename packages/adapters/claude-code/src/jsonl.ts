import { readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { SessionMeta } from "@overseer/protocol";
import { projectDirSlug } from "./project-slug.js";
import { resolveSessionTitle } from "./session-titles.js";

const ADAPTER_ID = "claude-code";

export function sessionJsonlPath(
  configDir: string,
  projectDir: string,
  sessionId: string,
): string {
  return path.join(
    configDir,
    "projects",
    projectDirSlug(projectDir),
    `${sessionId}.jsonl`,
  );
}

/** One line of a CLI transcript. */
export interface JsonlRecord {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: {
    role?: string;
    content?: unknown;
  };
}

/** Parse one transcript, skipping lines the CLI's undocumented format has
 * drifted on. Exported so a second reader of these files does not have to
 * repeat the skipping rules. */
export async function parseJsonlFile(filePath: string): Promise<JsonlRecord[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: JsonlRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line) as JsonlRecord);
    } catch {
      // Skip malformed lines — JSONL is undocumented and may drift.
    }
  }
  return records;
}

async function readSessionMetaFromJsonl(
  configDir: string,
  filePath: string,
  sessionId: string,
  projectDir: string,
): Promise<SessionMeta | undefined> {
  const records = await parseJsonlFile(filePath);
  if (records.length === 0) return undefined;

  let createdAt = new Date().toISOString();
  let lastActiveAt = createdAt;
  let gitBranch: string | undefined;
  let cwd = projectDir;
  let totalCostUsd = 0;

  for (const record of records) {
    if (record.timestamp) {
      if (createdAt === lastActiveAt) createdAt = record.timestamp;
      lastActiveAt = record.timestamp;
    }
    if (record.cwd) cwd = record.cwd;
    if (record.gitBranch) gitBranch = record.gitBranch;
  }

  const title = await resolveSessionTitle(configDir, cwd, sessionId);

  return {
    id: sessionId,
    adapterId: ADAPTER_ID,
    name: title,
    projectDir: cwd,
    gitBranch,
    status: "dormant",
    createdAt,
    lastActiveAt,
    totalCostUsd,
  };
}

export async function listSessionsForProject(
  configDir: string,
  projectDir: string,
): Promise<SessionMeta[]> {
  const dir = path.join(configDir, "projects", projectDirSlug(projectDir));
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const sessions: SessionMeta[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const sessionId = file.slice(0, -".jsonl".length);
    const meta = await readSessionMetaFromJsonl(
      configDir,
      path.join(dir, file),
      sessionId,
      projectDir,
    );
    if (meta !== undefined) sessions.push(meta);
  }

  return sessions.sort(
    (a, b) =>
      new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
  );
}

/** Permanently remove a session's transcript. Idempotent: a session already
 * gone (or one that never reached disk) is not an error. */
export async function deleteSessionTranscript(
  configDir: string,
  projectDir: string,
  sessionId: string,
): Promise<void> {
  const filePath = sessionJsonlPath(configDir, projectDir, sessionId);
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
