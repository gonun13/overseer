import { WProviderNote, WRow } from "./bits";
import { TrashIcon } from "../icons";
import type { Project, ProviderInfo, Session } from "../../domain";

export function SessionsWindow({
  sessions,
  projects,
  provider,
  onOpenSession,
  onNewSession,
  onDeleteSession,
}: {
  sessions: Session[];
  projects: Project[];
  provider: ProviderInfo;
  onOpenSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
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
            // Unset fields are omitted rather than shown blank, so the line
            // never reads as " · · " with the values rubbed out.
            secondary={[project?.name, s.branch, s.model, s.doing]
              .filter(Boolean)
              .join(" · ")}
            right={s.cost}
            actions={
              <>
                <button className="w-btn" onClick={() => onOpenSession(s.id)}>
                  open
                </button>
                <button className="w-btn">fork</button>
                <button
                  className="w-btn danger"
                  onClick={() => onDeleteSession(s.id)}
                  aria-label={`delete ${s.name}`}
                >
                  <TrashIcon />
                  delete
                </button>
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
