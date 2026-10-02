import type { ConsoleInfo } from "@overseer/protocol";
import { StatusLight } from "./StatusLight";
import { ChevronIcon, CloseIcon, StopIcon, TrashIcon } from "./icons";
import type { Session } from "../domain";
import { ACTIVITY_RANK, type Activity } from "../status";
import { consoleLight } from "../state/useConsoles";

/**
 * Bottom-left. Two lists that open upward over a readout header:
 *
 * - every console the server is running, in any project — the dock windows
 *   come back from, since closing a console window only detaches it;
 * - the active project's sessions, lit by the console running each one.
 *   Picking one shows its console, or resumes it in a new one.
 *
 * Selecting never closes the panel: like the project panel this is a status
 * list first, and the lights are how agents in flight are seen at all.
 */
export function SessionPanel({
  consoles,
  sessions,
  projectName,
  open,
  canStartSession,
  onToggle,
  onShowConsole,
  onKillConsole,
  onDismissConsole,
  onSelectSession,
  onDeleteSession,
  onNewSession,
  onNewShell,
  onTile,
}: {
  consoles: ConsoleInfo[];
  sessions: Session[];
  projectName?: string;
  open: boolean;
  /** An attached, signed-in provider — otherwise "new session" is hidden. */
  canStartSession: boolean;
  onToggle: () => void;
  onShowConsole: (console: ConsoleInfo) => void;
  onKillConsole: (id: string) => void;
  onDismissConsole: (id: string) => void;
  onSelectSession: (session: Session) => void;
  onDeleteSession: (id: string) => void;
  onNewSession: () => void;
  onNewShell: () => void;
  onTile: () => void;
}) {
  const running = consoles.filter((c) => c.status === "running");
  const hottest = consoles
    .map(consoleLight)
    .reduce<Activity>(
      (a, b) => (ACTIVITY_RANK[b] < ACTIVITY_RANK[a] ? b : a),
      "idle",
    );

  return (
    <section className="sessions settles-in">
      <div className={`sessions-list ${open ? "open" : ""}`}>
        <p className="sessions-section">consoles</p>
        {consoles.length === 0 && <p className="sessions-empty">none running</p>}
        {consoles.map((c) => (
          <div
            key={c.id}
            role="button"
            tabIndex={0}
            className="session-row"
            onClick={() => onShowConsole(c)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onShowConsole(c);
              }
            }}
          >
            <StatusLight activity={consoleLight(c)} />
            <span className="session-row-name">{c.title}</span>
            <span className="session-row-note">
              {c.status === "exited" ? "exited" : c.activity === "waiting" ? "waiting" : c.kind}
            </span>
            {c.status === "running" ? (
              <button
                className="session-row-stop"
                aria-label={`kill ${c.title}`}
                title="kill"
                onClick={(e) => {
                  e.stopPropagation();
                  onKillConsole(c.id);
                }}
              >
                <StopIcon />
              </button>
            ) : (
              <button
                className="session-row-delete"
                aria-label={`dismiss ${c.title}`}
                title="dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismissConsole(c.id);
                }}
              >
                <CloseIcon />
              </button>
            )}
          </div>
        ))}

        <p className="sessions-section">sessions · {projectName ?? "no project"}</p>
        {sessions.length === 0 && <p className="sessions-empty">no sessions yet</p>}
        {sessions.map((session) => (
          <div
            key={session.id}
            role="button"
            tabIndex={0}
            className={`session-row ${session.consoleId !== undefined ? "current" : ""}`}
            onClick={() => onSelectSession(session)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectSession(session);
              }
            }}
          >
            <StatusLight activity={session.activity} />
            <span className="session-row-name">{session.name}</span>
            <span className="session-row-note">{session.branch || session.providerId}</span>
            {/* Not while a CLI is writing the transcript — a running console
                or a loop run — since deleting it from under that process
                would only have it rewritten. */}
            {session.origin !== "loop" && session.consoleId === undefined && (
              <button
                className="session-row-delete"
                aria-label={`delete ${session.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteSession(session.id);
                }}
              >
                <TrashIcon />
              </button>
            )}
          </div>
        ))}

        <div className="sessions-actions">
          {canStartSession && (
            <button className="session-row session-new" onClick={onNewSession}>
              + new session
            </button>
          )}
          <button className="session-row session-new" onClick={onNewShell}>
            + shell
          </button>
          {running.length > 1 && (
            <button className="session-row session-new" onClick={onTile}>
              tile
            </button>
          )}
        </div>
      </div>

      <div className="sessions-head">
        <StatusLight activity={hottest} size={10} />
        <span className="sessions-kicker">consoles</span>
        <span className="sessions-value">
          {running.length === 0 ? "none" : `${running.length} running`}
        </span>
        <button
          className="chevron-btn"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? "collapse session list" : "expand session list"}
        >
          <ChevronIcon open={open} />
        </button>
      </div>
    </section>
  );
}
