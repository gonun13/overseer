import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ClientMessage,
  ConsoleInfo,
  ServerMessage,
  SessionMeta,
} from "@overseer/protocol";
import type { Session } from "../domain";
import { consoleLight } from "./console-light.ts";

/** Longest name a row shows before an ellipsis. */
const SESSION_NAME_MAX = 60;

function truncateSessionName(name: string): string {
  if (name.length <= SESSION_NAME_MAX) return name;
  return `${name.slice(0, SESSION_NAME_MAX - 1)}…`;
}

/**
 * One listed session as a row, lit by the console running it when there is
 * one. A session with no console is dormant on disk — its light is off.
 */
export function metaToSession(meta: SessionMeta, running?: ConsoleInfo): Session {
  return {
    id: meta.id,
    activity: running === undefined ? "idle" : consoleLight(running),
    name: truncateSessionName(meta.name ?? "new session"),
    projectId: meta.projectDir,
    providerId: meta.adapterId,
    branch: meta.gitBranch ?? "",
    lastActiveAt: meta.lastActiveAt,
    ...(running !== undefined ? { consoleId: running.id } : {}),
    ...(meta.origin !== undefined ? { origin: meta.origin } : {}),
    ...(meta.loopWorkspace !== undefined ? { loopWorkspace: meta.loopWorkspace } : {}),
    ...((running?.callsign ?? meta.callsign) !== undefined
      ? { callsign: (running?.callsign ?? meta.callsign)! }
      : {}),
  };
}

/** A running console's session before its transcript reaches disk. */
export function consoleToSession(running: ConsoleInfo): Session {
  return {
    id: running.sessionId!,
    activity: consoleLight(running),
    name: "new session",
    projectId: running.projectPath,
    providerId: running.providerId ?? "",
    branch: "",
    lastActiveAt: running.startedAt,
    consoleId: running.id,
    ...(running.kind === "loop" ? { origin: "loop" as const } : {}),
    ...(running.callsign !== undefined ? { callsign: running.callsign } : {}),
  };
}

/**
 * Every provider session in the workspace, from the transcripts the CLIs
 * write. The server rebuilds and broadcasts the list whenever a transcript
 * changes, so a session started in any console shows up on its own.
 */
export function useSessions(
  send: (message: ClientMessage) => void,
  subscribe: (listener: (message: ServerMessage) => void) => () => void,
  connected: boolean,
  consoles: ConsoleInfo[],
) {
  const [metas, setMetas] = useState<SessionMeta[]>([]);

  useEffect(
    () =>
      subscribe((message) => {
        if (message.type === "session.list") {
          setMetas(message.sessions);
          return;
        }
        if (message.type === "session.meta") {
          setMetas((current) => {
            const i = current.findIndex((m) => m.id === message.session.id);
            if (i === -1) return [...current, message.session];
            const next = current.slice();
            next[i] = message.session;
            return next;
          });
        }
      }),
    [subscribe],
  );

  useEffect(() => {
    if (connected) send({ type: "session.list" });
  }, [connected, send]);

  const sessions = useMemo(() => {
    const running = new Map<string, ConsoleInfo>();
    for (const c of consoles) {
      if (c.sessionId !== undefined && c.status === "running") running.set(c.sessionId, c);
    }
    const listed = new Set(metas.map((meta) => meta.id));
    return [
      ...metas.map((meta) => metaToSession(meta, running.get(meta.id))),
      // A CLI writes its transcript only once the first turn lands, so a
      // console just started is a session the index cannot see yet.
      ...[...running.values()]
        .filter((c) => !listed.has(c.sessionId!))
        .map(consoleToSession),
    ].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  }, [metas, consoles]);

  const deleteSession = useCallback(
    (id: string) => {
      send({ type: "session.delete", sessionId: id });
      // Gone here at once rather than on the next broadcast — the row should
      // not linger under the operator's cursor.
      setMetas((current) => current.filter((m) => m.id !== id));
    },
    [send],
  );

  return { sessions, deleteSession };
}
