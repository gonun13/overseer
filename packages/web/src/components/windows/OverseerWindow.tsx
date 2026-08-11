import { WStep } from "./bits";
import type { OperationStep } from "../../domain";

/**
 * The overseer's report on its own multi-step work — discovery today, any
 * automation or adapter-backed query later (docs/overseer.md §3).
 *
 * The one window kind summoned by the machine rather than the operator: no
 * footer link and no typed command opens it. It appears because the overseer
 * started doing something and owes the operator a view of it.
 *
 * Built for a growing list. Steps append as they arrive, and the last one is
 * normally still `working` — a finished batch rendered at the end would defeat
 * the reason for showing it at all.
 */
export function OverseerWindow({ steps }: { steps: OperationStep[] }) {
  return (
    <div className="w-steps">
      {steps.length === 0 ? (
        // Reachable for a beat before the first step arrives. Says what it is
        // waiting for rather than sitting blank.
        <span className="w-empty">standing by</span>
      ) : (
        steps.map((step) => (
          <WStep
            key={step.id}
            label={step.label}
            activity={step.activity}
            detail={step.detail}
          />
        ))
      )}
    </div>
  );
}
