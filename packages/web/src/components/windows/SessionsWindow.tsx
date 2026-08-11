import { WRow } from "./bits";
import type { Project, Session } from "../../data/mock";

export function SessionsWindow({
  sessions,
  projects,
  onOpenSession,
  onNewSession,
}: {
  sessions: Session[];
  projects: Project[];
  onOpenSession: (id: string) => void;
  onNewSession: () => void;
}) {
  return (
    <div>
      {sessions.map((s) => {
        const project = projects.find((p) => p.id === s.projectId);
        return (
          <WRow
            key={s.id}
            activity={s.activity}
            primary={s.name}
            secondary={`${project?.name ?? s.projectId} · ${s.branch} · ${s.model} — ${s.doing}`}
            right={s.cost}
            actions={
              <>
                <button className="w-btn" onClick={() => onOpenSession(s.id)}>
                  open
                </button>
                <button className="w-btn">fork</button>
                <button className="w-btn danger">stop</button>
              </>
            }
          />
        );
      })}
      <div className="btn-row">
        <button className="w-btn" onClick={onNewSession}>
          + new session
        </button>
      </div>
    </div>
  );
}
