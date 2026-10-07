import type { ConsoleInfo } from "@overseer/protocol";
import { StatusLight } from "./StatusLight";
import { ChevronIcon, CloseIcon, StopIcon, TrashIcon } from "./icons";
import type { Session } from "../domain";
import { ACTIVITY_RANK, type Activity } from "../status";
import { consoleLight } from "../state/useConsoles";
import {
  agentName,
  projectName as nameOf,
  railRows,
} from "../state/session-rail";

/**
 * Left rail, under the project panel. A readout header over one list
 * (`railRows`): every console the server is running — agent, loop and shell,
 * in any project — the dock windows come back from, since closing a console
 * window only detaches it; then the active project's sessions no console
 * holds. Picking one shows its console, or resumes it in a new one. A row is
 * its light, its name and its project; what it is doing is the light's to
 * show.
 *
 * Selecting never closes the panel: like the project panel this is a status
 * list first, and the lights are how agents in flight are seen at all.
 */
export function SessionPanel({
  consoles,
  sessions,
  projectPath,
  open,
  onToggle,
  onShowConsole,
  onKillConsole,
  onDismissConsole,
  onSelectSession,
  onDeleteSession,
}: {
  consoles: ConsoleInfo[];
  /** Every session in the workspace; the rail scopes the dormant ones. */
  sessions: Session[];
  projectPath?: string;
  open: boolean;
  onToggle: () => void;
  onShowConsole: (console: ConsoleInfo) => void;
  onKillConsole: (id: string) => void;
  onDismissConsole: (id: string) => void;
  onSelectSession: (session: Session) => void;
  onDeleteSession: (id: string) => void;
}) {
  const rows = railRows(consoles, sessions, projectPath);
  const running = consoles.filter((c) => c.status === "running");
  const hottest = consoles
    .map(consoleLight)
    .reduce<Activity>(
      (a, b) => (ACTIVITY_RANK[b] < ACTIVITY_RANK[a] ? b : a),
      "idle",
    );

  return (
    <section className="sessions settles-in">
      <div className="sessions-head">
        <StatusLight activity={hottest} size={10} />
        <span className="sessions-kicker">sessions</span>
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
      <div className={`sessions-list ${open ? "open" : ""}`}>
        {rows.length === 0 && <p className="sessions-empty">no sessions yet</p>}
        {rows.map((row) =>
          row.kind === "console" ? (
            <ConsoleRow
              key={row.console.id}
              console={row.console}
              name={row.name}
              onShow={onShowConsole}
              onKill={onKillConsole}
              onDismiss={onDismissConsole}
            />
          ) : (
            <div
              key={row.session.id}
              role="button"
              tabIndex={0}
              className="session-row"
              onClick={() => onSelectSession(row.session)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectSession(row.session);
                }
              }}
            >
              <StatusLight activity={row.session.activity} />
              <span className="session-row-name">
                {agentName(row.session.callsign, row.session.name)}
              </span>
              <span className="row-sep" aria-hidden>
                ·
              </span>
              <span className="session-row-project">
                {nameOf(row.session.projectId)}
              </span>
              {/* Not for a loop run's transcript, which its lease owns. A
                  session a console is running is listed as that console. */}
              {row.session.origin !== "loop" && (
                <button
                  className="session-row-delete"
                  aria-label={`delete ${row.session.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(row.session.id);
                  }}
                >
                  <TrashIcon />
                </button>
              )}
            </div>
          ),
        )}
      </div>
    </section>
  );
}

function ConsoleRow({
  console: c,
  name,
  onShow,
  onKill,
  onDismiss,
}: {
  console: ConsoleInfo;
  name: string;
  onShow: (console: ConsoleInfo) => void;
  onKill: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`session-row ${c.status === "running" && c.kind !== "shell" ? "current" : ""}`}
      onClick={() => onShow(c)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onShow(c);
        }
      }}
    >
      <StatusLight activity={consoleLight(c)} />
      <span className="session-row-name">{name}</span>
      <span className="row-sep" aria-hidden>
        ·
      </span>
      <span className="session-row-project">{nameOf(c.projectPath)}</span>
      {/* The relays waiting on it, the pending mark (spec/ui-ux.md §6). */}
      {c.pendingRelays !== undefined && (
        <span className="session-row-note">{c.pendingRelays} queued</span>
      )}
      {c.status === "running" ? (
        <button
          className="session-row-stop"
          aria-label={`kill ${name}`}
          title="kill"
          onClick={(e) => {
            e.stopPropagation();
            onKill(c.id);
          }}
        >
          <StopIcon />
        </button>
      ) : (
        <button
          className="session-row-delete"
          aria-label={`dismiss ${name}`}
          title="dismiss"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(c.id);
          }}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

/**
 * Foot of the left rail: the ways a console starts. `tile` only once there is
 * more than one window to lay out — the stage re-tiles on its own whenever
 * one opens or closes, so this is the way back after a drag or resize.
 */
export function SessionActions({
  canStartSession,
  windowCount,
  onNewSession,
  onNewShell,
  onTile,
}: {
  /** An attached, signed-in provider — otherwise "new session" is hidden. */
  canStartSession: boolean;
  windowCount: number;
  onNewSession: () => void;
  onNewShell: () => void;
  onTile: () => void;
}) {
  return (
    <div className="sessions-actions settles-in">
      {canStartSession && (
        <button className="rail-btn" onClick={onNewSession}>
          + new session
        </button>
      )}
      <button className="rail-btn" onClick={onNewShell}>
        + shell
      </button>
      {windowCount > 1 && (
        <button className="rail-btn" onClick={onTile}>
          tile
        </button>
      )}
    </div>
  );
}
