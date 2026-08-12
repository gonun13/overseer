import { WAdapterNote, WRow } from "./bits";
import type { AdapterInfo, Capability } from "../../domain";

export function CapabilitiesWindow({
  capabilities,
  adapter,
  onEdit,
}: {
  capabilities: Capability[];
  adapter: AdapterInfo;
  onEdit: (name: string) => void;
}) {
  return (
    <div>
      <WAdapterNote adapter={adapter} />
      {capabilities.length === 0 && (
        <div className="w-empty">nothing configured</div>
      )}
      {capabilities.map((c) => (
        <WRow
          key={c.id}
          activity={c.activity}
          primary={c.name}
          secondary={c.problem ? `${c.kind} · ${c.problem}` : c.kind}
          right={c.tools ? `${c.tools} tools` : ""}
          actions={
            <>
              <button className="w-btn" onClick={() => onEdit(c.name)}>
                edit
              </button>
              <button className="w-btn danger">remove</button>
            </>
          }
        />
      ))}
      <div className="btn-row">
        <button className="w-btn">+ mcp server</button>
        <button className="w-btn">+ skill</button>
        <button className="w-btn">+ subagent</button>
      </div>
    </div>
  );
}
