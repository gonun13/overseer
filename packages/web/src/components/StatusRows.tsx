import { useLayoutEffect, useRef } from "react";
import type { SpaceStatusEntry } from "@overseer/protocol";
import { WStep } from "./windows/bits";
import { OUTCOME_ACTIVITY } from "../status";

/** How close to the foot of the list still counts as following it. */
const FOLLOW_SLACK_PX = 24;

/**
 * The services' telegraphic report (spec/behaviour/overseer.md §3), in the
 * right rail's overseer layer from the first discovery step — never in the
 * stage centre, so it does not move when the overseer space docks above it.
 *
 * Pinned to the foot of the layer, just over the prompt. Conditions first,
 * then what happened, newest last — so the list follows its foot as rows
 * land, unless the operator has scrolled up to read something, in which case
 * it stays put.
 */
export function StatusRows({ rows }: { rows: SpaceStatusEntry[] }) {
  const listRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list !== null && following.current) list.scrollTop = list.scrollHeight;
  }, [rows]);

  if (rows.length === 0) return null;

  return (
    <div className="os-status">
      <p className="os-status-kicker">status</p>
      <div
        ref={listRef}
        className="w-steps os-status-rows"
        onScroll={(e) => {
          const list = e.currentTarget;
          following.current =
            list.scrollHeight - list.scrollTop - list.clientHeight <=
            FOLLOW_SLACK_PX;
        }}
      >
        {rows.map((row) => (
          <WStep
            key={`${row.service}:${row.key}:${row.mode === "event" ? row.at : ""}`}
            label={row.label}
            activity={OUTCOME_ACTIVITY[row.outcome]}
            detail={row.detail}
          />
        ))}
      </div>
    </div>
  );
}
