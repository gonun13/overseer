import { WProviderNote, WRow } from "./bits";
import type { Capability, ProviderInfo } from "../../domain";

export function CapabilitiesWindow({
  capabilities,
  provider,
  onEdit,
}: {
  capabilities: Capability[];
  provider: ProviderInfo;
  onEdit: (name: string) => void;
}) {
  return (
    <div>
      <WProviderNote provider={provider} />
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
