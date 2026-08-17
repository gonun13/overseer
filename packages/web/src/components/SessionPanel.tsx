import { StatusLight } from "./StatusLight";
import { ChevronIcon } from "./icons";
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
}: {
  sessions: Session[];
  activeId?: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (session: Session) => void;
  onNew: () => void;
}) {
  const active = sessions.find((session) => session.id === activeId);

  return (
    <section className="sessions settles-in">
      <div className={`sessions-list ${open ? "open" : ""}`}>
        {sessions.length === 0 && (
          <p className="sessions-empty">nothing running</p>
        )}

        {sessions.map((session) => (
          <button
            key={session.id}
            className={`session-row ${session.id === activeId ? "current" : ""}`}
            onClick={() => onSelect(session)}
          >
            <StatusLight activity={session.activity} />
            <span className="session-row-name">{session.name}</span>
            <span className="session-row-note">
              {session.branch || "branch unknown"}
            </span>
          </button>
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
