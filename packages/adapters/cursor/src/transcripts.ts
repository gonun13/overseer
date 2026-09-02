import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { SessionMeta, TurnWire } from "@overseer/protocol";

/**
 * Cursor's on-disk session state — captured against the real CLI (`agent
 * 2026.08.31-4057e58`), not published:
 *
 *   ~/.cursor/projects/<slug>/.workspace-trusted   {workspacePath, ...}
 *   ~/.cursor/projects/<slug>/agent-transcripts/<chatId>/<chatId>.jsonl
 *   ~/.cursor/chats/<hash>/<chatId>/meta.json      {createdAtMs, updatedAtMs, cwd, ...}
 *
 * `<slug>` looked collision-prone the way claude-code's own project slug is
 * (a lossy sanitize of the path, not a reversible encoding), so this never
 * inverts one — `.workspace-trusted`'s `workspacePath` is the exact original
 * path instead, written every time this adapter opens a session (it always
 * passes `--trust`). A project this adapter has never opened has no
 * `.workspace-trusted` and so is invisible to `listProjectSessions` — the
 * honest answer, not a guess.
 *
 * `<hash>` in `chats/` has no known derivation, so anything keyed under it
 * (`findProjectDirForSession`, `deleteSession`'s second half) scans every
 * hash directory for the one `<chatId>` subdirectory that matches — cheap
 * enough at the scale one operator's `~/.cursor` reaches.
 */

const MAX_TITLE_LEN = 35;

function cursorHome(): string {
  return process.env.HOME ?? "/home/overseer";
}

function projectsRoot(): string {
  return path.join(cursorHome(), ".cursor", "projects");
}

function chatsRoot(): string {
  return path.join(cursorHome(), ".cursor", "chats");
}

function truncateTitle(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= MAX_TITLE_LEN) return trimmed;
  return `${trimmed.slice(0, MAX_TITLE_LEN - 1)}…`;
}

/** The operator's own words, unwrapped from the `<timestamp>…</timestamp>
 * <user_query>…</user_query>` envelope the CLI writes around every user
 * turn in the transcript — without this every title would open on
 * "<timestamp>Wednesday, …". */
function operatorText(rawText: string): string {
  const match = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/.exec(rawText);
  return (match?.[1] ?? rawText).trim();
}

async function readTrustedPath(slug: string): Promise<string | undefined> {
  try {
    const raw = await readFile(
      path.join(projectsRoot(), slug, ".workspace-trusted"),
      "utf8",
    );
    const obj = JSON.parse(raw) as { workspacePath?: unknown };
    return typeof obj.workspacePath === "string" ? obj.workspacePath : undefined;
  } catch {
    return undefined;
  }
}

/** The `<projects>/<slug>` this adapter opened `projectDir` under, or
 * undefined if it never has. */
async function slugForProject(projectDir: string): Promise<string | undefined> {
  let entries: string[];
  try {
    entries = await readdir(projectsRoot());
  } catch {
    return undefined;
  }
  for (const slug of entries) {
    if ((await readTrustedPath(slug)) === projectDir) return slug;
  }
  return undefined;
}

interface ParsedChat {
  turns: TurnWire[];
  firstUserText?: string;
}

async function readChatTranscript(slug: string, chatId: string): Promise<ParsedChat> {
  const file = path.join(
    projectsRoot(),
    slug,
    "agent-transcripts",
    chatId,
    `${chatId}.jsonl`,
  );
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return { turns: [] };
  }

  const turns: TurnWire[] = [];
  let firstUserText: string | undefined;
  let seq = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof record !== "object" || record === null) continue;
    const obj = record as Record<string, unknown>;
    if (obj.role !== "user" && obj.role !== "assistant") continue;
    const message = obj.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter(
        (block): block is { type: string; text: string } =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string",
      )
      .map((block) => block.text)
      .join("");
    if (text === "") continue;

    seq += 1;
    if (obj.role === "user") {
      const clean = operatorText(text);
      turns.push({ id: `${chatId}-${seq}`, kind: "user", text: clean });
      if (firstUserText === undefined) firstUserText = clean;
    } else {
      turns.push({ id: `${chatId}-${seq}`, kind: "agent", text });
    }
  }
  return { turns, firstUserText };
}

interface ChatMeta {
  createdAtMs?: number;
  updatedAtMs?: number;
  cwd?: string;
}

/** Scan every `chats/<hash>/` for the one carrying `<chatId>/meta.json`. */
async function findChatMeta(chatId: string): Promise<ChatMeta | undefined> {
  let hashDirs: string[];
  try {
    hashDirs = await readdir(chatsRoot());
  } catch {
    return undefined;
  }
  for (const hash of hashDirs) {
    const metaPath = path.join(chatsRoot(), hash, chatId, "meta.json");
    let raw: string;
    try {
      raw = await readFile(metaPath, "utf8");
    } catch {
      continue;
    }
    try {
      return JSON.parse(raw) as ChatMeta;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** The project directory a chat id was opened under — for `resumeSession`,
 * which is handed only an id. */
export async function findProjectDirForSession(chatId: string): Promise<string> {
  const meta = await findChatMeta(chatId);
  if (meta?.cwd !== undefined && meta.cwd !== "") return meta.cwd;
  throw new Error(`session not found: ${chatId}`);
}

export async function listProjectSessions(projectDir: string): Promise<SessionMeta[]> {
  const slug = await slugForProject(projectDir);
  if (slug === undefined) return [];

  const transcriptsDir = path.join(projectsRoot(), slug, "agent-transcripts");
  let chatIds: string[];
  try {
    chatIds = await readdir(transcriptsDir);
  } catch {
    return [];
  }

  const sessions: SessionMeta[] = [];
  for (const chatId of chatIds) {
    const meta = await findChatMeta(chatId);
    const { firstUserText } = await readChatTranscript(slug, chatId);
    const createdAt =
      meta?.createdAtMs !== undefined
        ? new Date(meta.createdAtMs).toISOString()
        : new Date(0).toISOString();
    const lastActiveAt =
      meta?.updatedAtMs !== undefined
        ? new Date(meta.updatedAtMs).toISOString()
        : createdAt;
    sessions.push({
      id: chatId,
      adapterId: "cursor",
      projectDir,
      // Not recorded anywhere on disk per-session — the live event stream
      // carries it (session.init/session.model); a dormant listing honestly
      // has nothing to report rather than a guess.
      model: "",
      status: "dormant",
      createdAt,
      lastActiveAt,
      totalCostUsd: 0,
      ...(firstUserText !== undefined ? { name: truncateTitle(firstUserText) } : {}),
    });
  }

  return sessions.sort(
    (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
  );
}

export async function readSessionHistory(
  projectDir: string,
  sessionId: string,
): Promise<TurnWire[]> {
  const slug = await slugForProject(projectDir);
  if (slug === undefined) return [];
  const { turns } = await readChatTranscript(slug, sessionId);
  return turns;
}

export async function lookupSessionTitle(
  projectDir: string,
  sessionId: string,
): Promise<string | undefined> {
  const slug = await slugForProject(projectDir);
  if (slug === undefined) return undefined;
  const { firstUserText } = await readChatTranscript(slug, sessionId);
  return firstUserText !== undefined ? truncateTitle(firstUserText) : undefined;
}

/** Permanently remove a session's transcript from both places it lives.
 * Idempotent: an already-gone (or never-written) session is not an error. */
export async function deleteSession(projectDir: string, sessionId: string): Promise<void> {
  const slug = await slugForProject(projectDir);
  if (slug !== undefined) {
    await rm(path.join(projectsRoot(), slug, "agent-transcripts", sessionId), {
      recursive: true,
      force: true,
    });
  }

  let hashDirs: string[];
  try {
    hashDirs = await readdir(chatsRoot());
  } catch {
    hashDirs = [];
  }
  for (const hash of hashDirs) {
    await rm(path.join(chatsRoot(), hash, sessionId), { recursive: true, force: true });
  }
}

/** Directory the server watches for sessions this adapter did not start —
 * one level above the per-project slugs, same reasoning as claude-code's. */
export function sessionsWatchPath(): string {
  return projectsRoot();
}
