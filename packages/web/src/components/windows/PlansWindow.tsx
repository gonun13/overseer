import { WProviderNote, WRow } from "./bits";
import type { Plan, ProviderInfo } from "../../domain";

/**
 * Plans the active project's sessions have produced, newest first.
 *
 * A plan is not a document of its own: it was said in a session, and that
 * session is where it can be continued. So the row opens that session, and
 * the action sends the implement turn into it — the output lands in the
 * conversation the operator already knows, not in a surface of its own.
 *
 * Retired plans (`done`, `archived`) are filtered out here rather than server
 * side: the server keeps every plan it can read, and this window is the one
 * that has an opinion about which of them are still open.
 */
export function PlansWindow({
  plans,
  provider,
  error,
  onOpenPlanSession,
  onImplementPlan,
  onSetPlanStatus,
}: {
  plans: Plan[];
  provider: ProviderInfo;
  error?: string;
  onOpenPlanSession: (sessionId: string) => void;
  onImplementPlan: (planId: string) => void;
  onSetPlanStatus: (planId: string, status: "done" | "open") => void;
}) {
  const open = plans.filter(
    (plan) => plan.status !== "done" && plan.status !== "archived",
  );
  return (
    <div>
      <WProviderNote provider={provider} />
      {error !== undefined && <p className="w-note">{error}</p>}
      {open.length === 0 && <div className="w-empty">no open plans</div>}
      {open.map((plan) => (
        <WRow
          key={plan.id}
          activity={plan.activity}
          primary={plan.title}
          // The session is named when it is still listed; a plan whose session
          // was deleted says so instead, because that changes what the button
          // below it does.
          secondary={[
            plan.status,
            plan.sessionExists ? plan.session : "session deleted",
            plan.when,
          ]
            .filter(Boolean)
            .join(" · ")}
          onClick={
            plan.sessionExists
              ? () => onOpenPlanSession(plan.sessionId)
              : undefined
          }
          actions={
            <>
              <button
                className="w-btn"
                onClick={(event) => {
                  // The row itself opens the session; without this the click
                  // would do both.
                  event.stopPropagation();
                  onImplementPlan(plan.id);
                }}
              >
                {plan.status === "in-progress" ? "resume" : "implement"}
              </button>
              <button
                className="w-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  onSetPlanStatus(plan.id, "done");
                }}
              >
                done
              </button>
            </>
          }
        />
      ))}
    </div>
  );
}
