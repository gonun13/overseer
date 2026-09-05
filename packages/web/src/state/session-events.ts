import type { AgentEvent, SessionMeta, TurnWire } from "@overseer/protocol";
import type { Activity } from "../status";
import type { Session, Turn } from "../domain";
import type { SessionSettings } from "../session";

/** Matches `BLANK_SESSION_SETTINGS` in `../session` — duplicated rather than
 * imported, because unlike the `type` import above, a value import forces
 * node's plain ESM loader (not just tsc/Vite) to resolve `../session` at
 * runtime, and it has no extension for the loader to find without a bundler's
 * help — this file is unit-tested directly under `node --test`, not bundled. */
const BLANK_SETTINGS: SessionSettings = { model: "", mode: "", agent: "" };

const SESSION_NAME_MAX = 35;

function truncateSessionName(name: string): string {
  if (name.length <= SESSION_NAME_MAX) return name;
  return `${name.slice(0, SESSION_NAME_MAX - 1)}…`;
}

/** What a tool call is acting on, for the one line a row gets. Falls back to
 * the tool's own name when its input names no file — a `Bash` call is not
 * about a path. Shared by tool rows and the approval that gates one. */
function toolTarget(input: unknown, toolName: string): string {
  if (
    typeof input === "object" &&
    input !== null &&
    typeof (input as { file_path?: unknown }).file_path === "string"
  ) {
    return (input as { file_path: string }).file_path;
  }
  return toolName;
}

export function turnWireToTurn(turn: TurnWire): Turn {
  if (turn.kind === "tool") {
    return {
      id: turn.id,
      kind: "tool",
      tool: turn.tool,
      target: turn.target,
    };
  }
  return { id: turn.id, kind: turn.kind, text: turn.text };
}

export function metaToSession(
  meta: SessionMeta,
  activity: Activity = "idle",
): Session {
  return {
    id: meta.id,
    activity,
    name: truncateSessionName(meta.name ?? "new session"),
    projectId: meta.projectDir,
    branch: meta.gitBranch ?? "",
    model: meta.model,
    cost:
      meta.totalCostUsd > 0 ? `$${meta.totalCostUsd.toFixed(4)}` : "",
    doing: meta.status === "live" ? "live" : "",
    ...(meta.origin !== undefined ? { origin: meta.origin } : {}),
    ...(meta.loopWorkspace !== undefined
      ? { loopWorkspace: meta.loopWorkspace }
      : {}),
  };
}

/**
 * What a session is armed with, as the *server* reported it — not what the
 * operator has picked. Absent fields stay absent: the control rows read "—"
 * until the provider says, rather than showing a plausible default.
 */
export function settingsFromMeta(meta: SessionMeta): Partial<SessionSettings> {
  return {
    ...(meta.model !== "" ? { model: meta.model } : {}),
    ...(meta.permissionMode !== undefined ? { mode: meta.permissionMode } : {}),
  };
}

export interface ChatSlice {
  session: Session;
  turns: Turn[];
}

/** One conversation: the metadata every session list renders, the transcript
 * its own window renders, and what it is armed with. */
export interface Chat {
  session: Session;
  turns: Turn[];
  settings: SessionSettings;
  /** Why this conversation is empty, when it is empty for a reason — a refused
   * `session.open`. Cleared by the next successful open. */
  note?: string;
}

/**
 * Reconcile local chats against one `session.list` reply. The server scopes
 * that reply to whichever project is active *right now*
 * (session-supervisor's `mergeList`), so it says nothing about any other
 * project's sessions — pruning against it wholesale used to wipe every other
 * project's transcripts out of memory on every switch, which is why a
 * session's output came back empty rather than not at all once the operator
 * switched back. A chat already known keeps its turns and only refreshes its
 * meta/settings from the server; a chat outside this reply's project scope
 * is left completely untouched.
 */
export function reconcileSessionList(
  current: Chat[],
  sessions: SessionMeta[],
): Chat[] {
  const byId = new Map(current.map((c) => [c.session.id, c]));
  for (const meta of sessions) {
    const existing = byId.get(meta.id);
    const session = metaToSession(meta, existing?.session.activity ?? "idle");
    if (existing) {
      byId.set(meta.id, {
        ...existing,
        session: { ...session, activity: existing.session.activity },
        settings: { ...existing.settings, ...settingsFromMeta(meta) },
      });
    } else {
      byId.set(meta.id, {
        session,
        turns: [],
        settings: { ...BLANK_SETTINGS, ...settingsFromMeta(meta) },
      });
    }
  }
  const ids = new Set(sessions.map((s) => s.id));
  const scopedProjectDirs = new Set(sessions.map((s) => s.projectDir));
  return [...byId.values()].filter(
    (c) => ids.has(c.session.id) || !scopedProjectDirs.has(c.session.projectId),
  );
}

/** Apply one live AgentEvent to a chat slice. Returns updated slice. */
export function applySessionEvent(
  chat: ChatSlice,
  event: AgentEvent,
): ChatSlice {
  let { session, turns } = chat;

  switch (event.type) {
    case "session.init":
      session = {
        ...session,
        model: event.model,
        branch: session.branch || "",
      };
      break;
    case "session.model":
      // A confirmed runtime switch — the same process, now armed differently
      // for its next turn. Nothing else about the session changed.
      session = { ...session, model: event.model };
      break;
    case "session.mode":
      // Same confirmation, for permission mode — but unlike model, mode has
      // no dedicated `Session` field to update here. The confirmed value
      // reaches the accordion via the `session.meta` broadcast the
      // supervisor already pushes (`settingsFromMeta`), same as every other
      // control row.
      break;
    case "text.delta": {
      const last = turns.at(-1);
      if (last?.kind === "agent") {
        turns = [
          ...turns.slice(0, -1),
          { ...last, text: last.text + event.text },
        ];
      } else {
        // One id per message, not per session — a user or tool turn ends the
        // run, and the next delta opens a turn of its own.
        turns = [
          ...turns,
          {
            id: `${event.sessionId}-a${turns.length}`,
            kind: "agent",
            text: event.text,
          },
        ];
      }
      // Guarded: an unconditional clone would hand every consumer a new session
      // identity per token, defeating the memos in useShellPresentation.
      if (session.activity !== "working")
        session = { ...session, activity: "working" };
      break;
    }
    case "thinking.delta":
      if (session.activity !== "working")
        session = { ...session, activity: "working" };
      // Claude can summarize or withhold reasoning entirely depending on
      // account/model settings — an empty delta carries no text to show, so
      // it must not open a turn that would sit there permanently blank.
      if (event.text === "") break;
      {
        const last = turns.at(-1);
        if (last?.kind === "thinking") {
          turns = [
            ...turns.slice(0, -1),
            { ...last, text: last.text + event.text },
          ];
        } else {
          // A thinking turn always precedes the reply it belongs to — once
          // text starts (or a tool call opens), the *next* thinking delta
          // (a later turn) opens a fresh bubble rather than resuming this one.
          turns = [
            ...turns,
            {
              id: `${event.sessionId}-th${turns.length}`,
              kind: "thinking",
              text: event.text,
            },
          ];
        }
      }
      break;
    case "tool.start":
      turns = [
        ...turns,
        {
          id: event.toolUseId,
          kind: "tool",
          tool: event.name,
          target: toolTarget(event.input, event.name),
          status: "running",
        },
      ];
      session = { ...session, activity: "working" };
      break;
    case "tool.end":
      turns = turns.map((turn) =>
        turn.kind === "tool" && turn.id === event.toolUseId
          ? { ...turn, status: event.isError ? "error" : "ok" }
          : turn,
      );
      break;
    case "permission.request":
      turns = [
        ...turns,
        {
          id: event.requestId,
          kind: "approval",
          tool: event.toolName,
          target: toolTarget(event.input, event.toolName),
        },
      ];
      session = {
        ...session,
        activity: "approval",
        doing: `waiting on your approval for ${event.toolName}`,
      };
      break;
    case "turn.end":
      session = {
        ...session,
        activity: "idle",
        cost:
          event.totalCostUsd > 0
            ? `$${event.totalCostUsd.toFixed(4)}`
            : session.cost,
      };
      // Stamp the reply that just finished with what actually produced it —
      // the session's own `model` names what the *next* turn will run on,
      // which is not always the same one after a runtime switch mid-session.
      if (event.model !== undefined) {
        const last = turns.at(-1);
        if (last?.kind === "agent") {
          turns = [...turns.slice(0, -1), { ...last, model: event.model }];
        }
      }
      break;
    case "error":
      session = {
        ...session,
        activity: "attention",
        // Overseer signals read `doing` for "what happened" — without this
        // the attention line is only the session name.
        doing: event.message,
      };
      break;
    case "exit":
      session = { ...session, activity: "idle", doing: "" };
      break;
    default:
      break;
  }

  return { session, turns };
}

/** Append a user turn locally before the server echoes it. */
export function appendUserTurn(
  chat: ChatSlice,
  text: string,
): ChatSlice {
  return {
    session: { ...chat.session, activity: "working" },
    turns: [
      ...chat.turns,
      {
        id: `${chat.session.id}-u${chat.turns.length}`,
        kind: "user",
        text,
      },
    ],
  };
}
