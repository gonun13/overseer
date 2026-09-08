import { StatusLight } from "./StatusLight";
import { ChevronIcon, StopIcon, TrashIcon } from "./icons";
import { isStoppable } from "../session";
import type { Session } from "../domain";

/**
 * Bottom-left. The project panel's two levels, mirrored: the collapsed header is
 * a readout so it stays on the field, the list is what you click into to act so
 * it is a surface. Bottom-anchored so the list opens *upward* and the header
 * sits beneath it — the header stays put while the list grows (ui-ux-design.md §6).
 *
 * Selecting never closes it: like the project panel this is a status list
 * first, and the lights are how sessions in flight are seen at all.
 */
export function SessionPanel({
  sessions,
  activeId,
  open,
  onToggle,
  onSelect,
  onNew,
  onStop,
  onDelete,
}: {
  sessions: Session[];
  activeId?: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (session: Session) => void;
  onNew: () => void;
  /** Interrupt the turn this session has in flight. */
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const active = sessions.find((session) => session.id === activeId);

  return (
    <section className="sessions settles-in">
      <div className={`sessions-list ${open ? "open" : ""}`}>
        {sessions.length === 0 && (
          <p className="sessions-empty">nothing running</p>
        )}

        {sessions.map((session) => (
          <div
            key={session.id}
            role="button"
            tabIndex={0}
            className={`session-row ${session.id === activeId ? "current" : ""}`}
            onClick={() => onSelect(session)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(session);
              }
            }}
          >
            <StatusLight activity={session.activity} />
            <span className="session-row-name">{session.name}</span>
            {/* The name already says `loop · <ws>`, so this stays the branch
                for every row rather than repeating it. */}
            <span className="session-row-note">
              {session.branch || "branch unknown"}
            </span>
            {/* Only while a turn is actually in flight: a row that offered a
                stop with nothing running would be a button that answers with
                an error. */}
            {isStoppable(session) && (
              <button
                className="session-row-stop"
                aria-label={`stop ${session.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onStop(session.id);
                }}
              >
                <StopIcon />
              </button>
            )}
            {/* A loop's transcript belongs to a live CLI — deleting it from
                under that process is not offered here either. */}
            {session.origin !== "loop" && (
              <button
                className="session-row-delete"
                aria-label={`delete ${session.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(session.id);
                }}
              >
                <TrashIcon />
              </button>
            )}
          </div>
        ))}

        {/* Nothing else in the app can start one, so the affordance lives with
            the list it fills rather than behind the sessions window. */}
        <button className="session-row session-new" onClick={onNew}>
          + new session
        </button>
      </div>

      <div className="sessions-head">
        <StatusLight activity={active?.activity ?? "idle"} size={10} />
        <span className="sessions-kicker">session</span>
        <span className="sessions-value">{active?.name ?? "none"}</span>
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
