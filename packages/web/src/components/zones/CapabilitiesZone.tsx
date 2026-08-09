import { useState } from "react";
import { ZoneHeader } from "../primitives/ZoneHeader";
import { ColumnHeader } from "../primitives/ColumnHeader";
import { RosterRow } from "../primitives/RosterRow";
import { mockCapabilities } from "../../data/mock";

export function CapabilitiesZone() {
  const [selected, setSelected] = useState(mockCapabilities[0]?.id);
  const active = mockCapabilities.find((c) => c.id === selected);

  return (
    <div className="flex h-full min-w-0">
      <div className="flex w-1/2 shrink-0 flex-col overflow-y-auto border-r border-border px-6 py-6">
        <ZoneHeader title="Capabilities" subtitle="MCP servers, skills, subagents, plugins" />
        <div className="mt-4">
          <ColumnHeader columns={[{ label: "Tools", width: "60px" }]} />
          {mockCapabilities.map((c) => (
            <RosterRow
              key={c.id}
              status={c.status}
              primary={c.name}
              secondary={c.kind}
              active={c.id === selected}
              onClick={() => setSelected(c.id)}
              columns={[{ value: String(c.tools), width: "60px" }]}
            />
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {active ? (
          <>
            <h2 className="text-[15px] font-bold">{active.name}</h2>
            <p className="mt-1 text-[12px] text-text-dim">{active.kind}</p>
            <p className="mt-6 text-[13px] text-text-faint">
              Edits go through an agent-driven side-task, not a form — ask for a change and it lands here
              when it's done.
            </p>
          </>
        ) : (
          <p className="text-[13px] text-text-faint">Select a capability.</p>
        )}
      </div>
    </div>
  );
}
