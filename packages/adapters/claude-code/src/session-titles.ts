import { readFile } from "node:fs/promises";
import path from "node:path";
import { operatorText } from "./operator-text.js";
import { projectDirSlug } from "./project-slug.js";

const MAX_TITLE_LEN = 35;

interface IndexEntry {
  sessionId?: string;
  customTitle?: string | null;
  summary?: string | null;
  firstPrompt?: string | null;
}

interface SessionsIndex {
  entries?: IndexEntry[];
}

interface JsonlTitleRecord {
  type?: string;
  customTitle?: string;
  agentName?: string;
  isMeta?: boolean;
  message?: {
    role?: string;
    content?: unknown;
  };
}

function truncateTitle(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= MAX_TITLE_LEN) return trimmed;
  return `${trimmed.slice(0, MAX_TITLE_LEN - 1)}…`;
}

function isUsableTitle(value: string | null | undefined): value is string {
  if (value === undefined || value === null) return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (trimmed.toLowerCase() === "no prompt") return false;
  return true;
}

async function readIndexEntry(
  configDir: string,
  projectDir: string,
  sessionId: string,
): Promise<IndexEntry | undefined> {
  const indexPath = path.join(
    configDir,
    "projects",
    projectDirSlug(projectDir),
    "sessions-index.json",
  );
  let raw: string;
  try {
    raw = await readFile(indexPath, "utf8");
  } catch {
    return undefined;
  }
  let index: SessionsIndex;
  try {
    index = JSON.parse(raw) as SessionsIndex;
  } catch {
    return undefined;
  }
  return index.entries?.find((entry) => entry.sessionId === sessionId);
}

async function readJsonlRecords(
  configDir: string,
  projectDir: string,
  sessionId: string,
): Promise<JsonlTitleRecord[]> {
  const filePath = path.join(
    configDir,
    "projects",
    projectDirSlug(projectDir),
    `${sessionId}.jsonl`,
  );
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return [];
  }
  const records: JsonlTitleRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line) as JsonlTitleRecord);
    } catch {
      // Skip malformed lines.
    }
  }
  return records;
}

function titleFromJsonlRecords(records: JsonlTitleRecord[]): string | undefined {
  for (const record of records) {
    if (record.type === "custom-title" && isUsableTitle(record.customTitle)) {
      return truncateTitle(record.customTitle);
    }
    if (record.type === "agent-name" && isUsableTitle(record.agentName)) {
      return truncateTitle(record.agentName);
    }
  }
  for (const record of records) {
    if (record.type !== "user") continue;
    const role = record.message?.role ?? record.type;
    if (role !== "user") continue;
    // Not simply the first user record: a session that opened with a slash
    // command has the CLI's caveat banner and command echo ahead of anything
    // the operator typed.
    const text = operatorText(record);
    if (text === undefined) continue;
    return truncateTitle(text);
  }
  return undefined;
}

/** Resolve a display title the way Claude Code's /resume picker would. */
export async function resolveSessionTitle(
  configDir: string,
  projectDir: string,
  sessionId: string,
): Promise<string | undefined> {
  const [indexEntry, jsonlRecords] = await Promise.all([
    readIndexEntry(configDir, projectDir, sessionId),
    readJsonlRecords(configDir, projectDir, sessionId),
  ]);

  if (isUsableTitle(indexEntry?.customTitle)) {
    return truncateTitle(indexEntry.customTitle);
  }

  const jsonlTitle = titleFromJsonlRecords(jsonlRecords);
  if (jsonlTitle !== undefined) return jsonlTitle;

  if (isUsableTitle(indexEntry?.summary)) {
    return truncateTitle(indexEntry.summary);
  }

  if (isUsableTitle(indexEntry?.firstPrompt)) {
    return truncateTitle(indexEntry.firstPrompt);
  }

  return undefined;
}
