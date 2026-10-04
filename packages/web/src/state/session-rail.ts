import type { ConsoleInfo } from "@overseer/protocol";
import type { Session } from "../domain";

/** What a console or session is called on its tab and rail row: the
 * callsign that addresses it, else `fallback` — never the session's title,
 * which the CLI owns and the operator does not need to read there. */
export function agentName(callsign: string | undefined, fallback: string): string {
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

/** One row of the left rail's lists: a console, or a session with none. */
export type RailRow =
  | { kind: "console"; console: ConsoleInfo; name: string; session?: Session }
  | { kind: "session"; session: Session };

export interface RailGroups {
  sessions: RailRow[];
  shells: ConsoleInfo[];
}

/**
 * The rail's two groups. Sessions: every agent and loop console, in any
 * project — closing a console window only detaches it, so this is where it
 * comes back from — then the active project's sessions no console holds.
 * Shells: every plain shell. A session a listed console is running is shown
 * once, as that console.
 */
export function railGroups(
  consoles: ConsoleInfo[],
  sessions: Session[],
  projectPath: string | undefined,
): RailGroups {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const held = new Set<string>();
  const consoleRows: RailRow[] = [];
  const shells: ConsoleInfo[] = [];

  for (const c of consoles) {
    if (c.kind === "shell") {
      shells.push(c);
      continue;
    }
    const session = c.sessionId === undefined ? undefined : byId.get(c.sessionId);
    if (c.sessionId !== undefined) held.add(c.sessionId);
    consoleRows.push({
      kind: "console",
      console: c,
      name: agentName(c.callsign, consoleKind(c)),
      ...(session !== undefined ? { session } : {}),
    });
  }

  const dormant: RailRow[] = sessions
    .filter((s) => s.projectId === projectPath && !held.has(s.id))
    .map((session) => ({ kind: "session", session }));

  return { sessions: [...consoleRows, ...dormant], shells };
}
