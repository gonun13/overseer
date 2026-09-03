import { WProviderNote, WRow, WUnavailable } from "./bits";
import type { Capability, ProviderInfo } from "../../domain";

/** MCP servers, skills and subagents for the attached provider. Nothing
 * enumerates them yet — `capabilities` is always empty and the add controls
 * are inert (architecture-design.md §3, Important tier). */
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
      <WUnavailable detail="mcp servers, skills and subagents are not read from the provider yet." />
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
        <button className="w-btn" disabled>
          + mcp server
        </button>
        <button className="w-btn" disabled>
          + skill
        </button>
        <button className="w-btn" disabled>
          + subagent
        </button>
      </div>
    </div>
  );
}
