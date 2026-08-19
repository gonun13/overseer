import { randomUUID } from "node:crypto";
import { readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { SessionMeta, TurnWire } from "@overseer/protocol";
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

interface JsonlRecord {
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

function asText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: string }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("");
}

function toolSummary(content: unknown): { tool: string; target: string } | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: string }).type === "tool_use"
    ) {
      const tool = (block as { name?: unknown }).name;
      const input = (block as { input?: unknown }).input;
      const target =
        typeof input === "object" &&
        input !== null &&
        typeof (input as { file_path?: unknown }).file_path === "string"
          ? (input as { file_path: string }).file_path
          : typeof input === "object" && input !== null
            ? JSON.stringify(input)
            : "";
      if (typeof tool === "string") {
        return { tool, target };
      }
    }
  }
  return undefined;
}

function turnFromRecord(record: JsonlRecord): TurnWire | undefined {
  if (record.type !== "user" && record.type !== "assistant") return undefined;
  const role = record.message?.role ?? record.type;
  if (role === "user") {
    const text = asText(record.message?.content);
    if (text === "") return undefined;
    return { id: record.uuid ?? randomUUID(), kind: "user", text };
  }
  if (role === "assistant") {
    const tool = toolSummary(record.message?.content);
    if (tool) {
      return {
        id: record.uuid ?? randomUUID(),
        kind: "tool",
        tool: tool.tool,
        target: tool.target,
      };
    }
    const text = asText(record.message?.content);
    if (text === "") return undefined;
    return { id: record.uuid ?? randomUUID(), kind: "agent", text };
  }
  return undefined;
}

async function parseJsonlFile(filePath: string): Promise<JsonlRecord[]> {
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
    model: "",
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

/** Walk parentUuid from newest leaf to root; skip sidechains. */
export async function backfillHistory(
  configDir: string,
  projectDir: string,
  sessionId: string,
): Promise<TurnWire[]> {
  const filePath = sessionJsonlPath(configDir, projectDir, sessionId);
  const records = await parseJsonlFile(filePath);
  if (records.length === 0) return [];

  const byUuid = new Map<string, JsonlRecord>();
  const childOf = new Map<string, string>();
  for (const record of records) {
    if (record.uuid === undefined) continue;
    byUuid.set(record.uuid, record);
    if (record.parentUuid) childOf.set(record.parentUuid, record.uuid);
  }

  let leaf: JsonlRecord | undefined;
  for (const record of records) {
    if (record.uuid === undefined || record.isSidechain) continue;
    if (!childOf.has(record.uuid)) {
      leaf = record;
    }
  }
  if (leaf?.uuid === undefined) {
    leaf = records.at(-1);
  }

  const chain: JsonlRecord[] = [];
  let current: JsonlRecord | undefined = leaf;
  while (current !== undefined) {
    if (!current.isSidechain) chain.push(current);
    const parent =
      current.parentUuid !== undefined && current.parentUuid !== null
        ? byUuid.get(current.parentUuid)
        : undefined;
    current = parent;
  }

  chain.reverse();
  const turns: TurnWire[] = [];
  for (const record of chain) {
    const turn = turnFromRecord(record);
    if (turn !== undefined) turns.push(turn);
  }
  return turns;
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
