import { ZoneHeader } from "../primitives/ZoneHeader";
import { ColumnHeader } from "../primitives/ColumnHeader";
import { RosterRow } from "../primitives/RosterRow";
import { mockSessions } from "../../data/mock";

export function SessionsZone() {
  return (
    <div className="flex h-full flex-col overflow-y-auto px-10 py-8">
      <ZoneHeader
        title="Sessions"
        subtitle="All sessions and background agents across every project under /work"
        control={
          <button className="border border-border-strong px-3 py-1.5 text-[12px] uppercase tracking-[1px] text-text hover:bg-panel-alt">
            + New session
          </button>
        }
      />
      <div className="mt-4">
        <ColumnHeader
          columns={[
            { label: "Project", width: "160px" },
            { label: "Branch", width: "140px" },
            { label: "Elapsed", width: "80px" },
          ]}
        />
        {mockSessions.map((s) => (
          <RosterRow
            key={s.id}
            status={s.status}
            primary={s.name}
            secondary={s.model}
            columns={[
              { value: s.project, width: "160px" },
              { value: s.branch, width: "140px" },
              { value: s.elapsed, width: "80px" },
            ]}
          />
        ))}
      </div>
    </div>
  );
}
