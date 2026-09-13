import type { SpaceStatusEntry } from "@overseer/protocol";
import { WStep } from "./bits";
import { OUTCOME_ACTIVITY } from "../../status";

/**
 * The overseer's report on its own work — discovery, the workspace monitor,
 * git operations, personality re-reads, and any later automation
 * (docs/overseer-behavior.md §3).
 *
 * The one window kind summoned by the machine rather than the operator: no
 * footer link and no typed command opens it. It appears because a service
 * started doing something and owes the operator a view of it.
 *
 * Rows arrive already ordered by `spaceRows` — conditions that hold right now
 * first, then the log of what happened. A condition rewrites itself in place,
 * so a row here can never outlive the fact behind it; that is the whole reason
 * the space exists.
 */
export function OverseerWindow({ rows }: { rows: SpaceStatusEntry[] }) {
  return (
    <div className="w-steps">
      {rows.length === 0 ? (
        // Reachable for a beat before the first row arrives. Says what it is
        // waiting for rather than sitting blank.
        <span className="w-empty">standing by</span>
      ) : (
        rows.map((row) => (
          <WStep
            key={`${row.service}:${row.key}:${row.mode === "event" ? row.at : ""}`}
            label={row.label}
            activity={OUTCOME_ACTIVITY[row.outcome]}
            detail={row.detail}
          />
        ))
      )}
    </div>
  );
}
