import { WRow } from "./bits";
import { TrashIcon } from "../icons";
import type { Project, Session } from "../../domain";

/** Every session in the workspace, across projects and providers. Opening one
 * shows the console running it, or resumes it in a new console. */
export function SessionsWindow({
  sessions,
  projects,
  onOpenSession,
  onDeleteSession,
}: {
  sessions: Session[];
  projects: Project[];
  onOpenSession: (session: Session) => void;
  onDeleteSession: (id: string) => void;
}) {
  return (
    <div>
      {sessions.length === 0 && <div className="w-empty">no sessions</div>}
      {sessions.map((s) => {
        const project = projects.find((p) => p.id === s.projectId);
        return (
          <WRow
            key={s.id}
            activity={s.activity}
            primary={s.name}
            secondary={[project?.name, s.providerId, s.branch].filter(Boolean).join(" · ")}
            actions={
              <>
                <button className="w-btn" onClick={() => onOpenSession(s)}>
                  {s.consoleId !== undefined || s.origin === "loop" ? "console" : "resume"}
                </button>
                {s.origin !== "loop" && s.consoleId === undefined && (
                  <button
                    className="w-btn danger"
                    onClick={() => onDeleteSession(s.id)}
                    aria-label={`delete ${s.name}`}
                  >
                    <TrashIcon />
                    delete
                  </button>
                )}
              </>
            }
          />
        );
      })}
    </div>
  );
}
