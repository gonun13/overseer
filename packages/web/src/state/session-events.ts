import type { AgentEvent, SessionMeta, TurnWire } from "@overseer/protocol";
import type { Activity } from "../status";
import type { Session, Turn } from "../domain";

const SESSION_NAME_MAX = 20;

function truncateSessionName(name: string): string {
  if (name.length <= SESSION_NAME_MAX) return name;
  return `${name.slice(0, SESSION_NAME_MAX - 1)}…`;
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
  };
}

export interface ChatSlice {
  session: Session;
  turns: Turn[];
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
      session = { ...session, activity: "working" };
      break;
    }
    case "thinking.delta":
      session = { ...session, activity: "working" };
      break;
    case "tool.start":
      turns = [
        ...turns,
        {
          id: event.toolUseId,
          kind: "tool",
          tool: event.name,
          target:
            typeof event.input === "object" &&
            event.input !== null &&
            typeof (event.input as { file_path?: unknown }).file_path ===
              "string"
              ? (event.input as { file_path: string }).file_path
              : event.name,
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
    case "turn.end":
      session = {
        ...session,
        activity: "idle",
        cost:
          event.totalCostUsd > 0
            ? `$${event.totalCostUsd.toFixed(4)}`
            : session.cost,
      };
      break;
    case "error":
      session = { ...session, activity: "attention" };
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
