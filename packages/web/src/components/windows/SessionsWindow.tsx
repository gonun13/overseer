import { WProviderNote, WRow } from "./bits";
import { StopIcon, TrashIcon } from "../icons";
import type { Project, ProviderInfo, Session } from "../../domain";
import type { ProviderOption } from "@overseer/protocol";
import { findOption, isStoppable } from "../../session";

export function SessionsWindow({
  sessions,
  projects,
  provider,
  models,
  onOpenSession,
  onNewSession,
  onStopSession,
  onDeleteSession,
}: {
  sessions: Session[];
  projects: Project[];
  provider: ProviderInfo;
  /** The model row's catalog — resolves a session's raw reported model id
   * back to the name the operator picked, the same as the session controls. */
  models: ProviderOption[];
  onOpenSession: (id: string) => void;
  onNewSession: () => void;
  /** Interrupt the turn this session has in flight. */
  onStopSession: (id: string) => void;
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
            secondary={[
              // No "loop" marker here: the name already reads `loop · <ws>`,
              // and repeating it would spend the line on the one thing the
              // row has already said.
              project?.name,
              s.branch,
              s.model === "" ? undefined : (findOption(models, s.model)?.label ?? s.model),
              s.doing,
            ]
              .filter(Boolean)
              .join(" · ")}
            right={s.cost}
            actions={
              <>
                <button className="w-btn" onClick={() => onOpenSession(s.id)}>
                  {s.origin === "loop" ? "console" : "open"}
                </button>
                {isStoppable(s) && (
                  <button
                    className="w-btn"
                    onClick={() => onStopSession(s.id)}
                    aria-label={`stop ${s.name}`}
                  >
                    <StopIcon />
                    stop
                  </button>
                )}
                {/* No delete for a loop run: its transcript belongs to a live
                    interactive CLI, and removing it out from under that
                    process is not something to offer as a row action. */}
                {s.origin !== "loop" && (
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
      <div className="btn-row">
        <button className="w-btn" onClick={onNewSession}>
          + new session
        </button>
      </div>
    </div>
  );
}
