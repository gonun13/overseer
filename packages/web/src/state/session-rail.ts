import type { ConsoleInfo } from "@overseer/protocol";
import type { Session } from "../domain";

/** What a console or session is called on its tab and rail row: the
 * callsign that addresses it, else `fallback` — never the session's title,
 * which the CLI owns and the operator does not need to read there. */
export function agentName(
  callsign: string | undefined,
  fallback: string,
): string {
  return callsign ?? fallback;
}

/** A project's name: the last segment of its path. */
export function projectName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** What a console is before it has a callsign: `shell`, `loop`, the provider. */
export function consoleKind(c: ConsoleInfo): string {
  return c.kind === "agent" ? (c.providerId ?? "agent") : c.kind;
}

/** One row of the left rail's list: a console, or a session with none. */
export type RailRow =
  | { kind: "console"; console: ConsoleInfo; name: string; session?: Session }
  | { kind: "session"; session: Session };

/**
 * The rail's one list: every console — agent, loop and shell, in any project,
 * since closing a console window only detaches it and this is where it comes
 * back from — then the active project's sessions no console holds. A session
 * a listed console is running is shown once, as that console.
 */
export function railRows(
  consoles: ConsoleInfo[],
  sessions: Session[],
  projectPath: string | undefined,
): RailRow[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const held = new Set<string>();
  const consoleRows: RailRow[] = consoles.map((c) => {
    const session =
      c.sessionId === undefined ? undefined : byId.get(c.sessionId);
    if (c.sessionId !== undefined) held.add(c.sessionId);
    return {
      kind: "console",
      console: c,
      name: agentName(c.callsign, consoleKind(c)),
      ...(session !== undefined ? { session } : {}),
    };
  });

  const dormant: RailRow[] = sessions
    .filter((s) => s.projectId === projectPath && !held.has(s.id))
    .map((session) => ({ kind: "session", session }));

  return [...consoleRows, ...dormant];
}
