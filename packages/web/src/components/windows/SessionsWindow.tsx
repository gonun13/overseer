import { WProviderNote, WRow } from "./bits";
import type { Project, ProviderInfo, Session } from "../../domain";

export function SessionsWindow({
  sessions,
  projects,
  provider,
  onOpenSession,
  onNewSession,
}: {
  sessions: Session[];
  projects: Project[];
  provider: ProviderInfo;
  onOpenSession: (id: string) => void;
  onNewSession: () => void;
}) {
  return (
    <div>
      <WProviderNote provider={provider} />
      {sessions.length === 0 && <div className="w-empty">no sessions</div>}
      {sessions.map((s) => {
        const project = projects.find((p) => p.id === s.projectId);
        return (
          <WRow
            key={s.id}
            activity={s.activity}
            primary={s.name}
            secondary={`${project?.name ?? s.projectId} · ${s.branch} · ${s.model} · ${s.doing}`}
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
