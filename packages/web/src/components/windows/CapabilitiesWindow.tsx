import { useState } from "react";
import type { Subagent } from "@overseer/protocol";
import { WConfirmButton, WProviderNote, WRow, WUnavailable } from "./bits";
import type { ProviderInfo } from "../../domain";
import type { SubagentsState } from "../../state/useSubagents";
import { scopeLabel, subagentSummary } from "../../subagents";

/**
 * MCP servers, skills and subagents for the attached provider.
 *
 * Three tabs rather than one list: they are three different things, kept in
 * three different places, and only one of them is enumerated today. A single
 * list would have to explain that in a sentence covering all three; a tab can
 * simply be honest about itself.
 *
 * Subagents open first — landing on one of the two dead tabs would make a
 * window that works read as one that does not.
 */
export function CapabilitiesWindow({
  provider,
  subagents,
  onEdit,
  onCreate,
}: {
  provider: ProviderInfo;
  subagents: SubagentsState;
  onEdit: (subagent: Subagent) => void;
  onCreate: () => void;
}) {
  const [tab, setTab] = useState<"subagents" | "mcp" | "skills">("subagents");

  return (
    <div>
      <div className="w-tabs">
        {(["subagents", "mcp", "skills"] as const).map((name) => (
          <button
            key={name}
            type="button"
            className={`w-tab ${tab === name ? "active" : ""}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === "subagents" && (
        <SubagentsTab
          provider={provider}
          subagents={subagents}
          onEdit={onEdit}
          onCreate={onCreate}
        />
      )}
      {tab === "mcp" && (
        <>
          <WProviderNote provider={provider} />
          <WUnavailable detail="mcp servers are not read from the provider yet." />
          <div className="w-empty">nothing configured</div>
        </>
      )}
      {tab === "skills" && (
        <>
          <WProviderNote provider={provider} />
          <WUnavailable detail="skills are not read from the provider yet." />
          <div className="w-empty">nothing configured</div>
        </>
      )}
    </div>
  );
}

/**
 * The operator's own subagent files, from both the project's `.claude/agents`
 * and their own. Both sides of a name collision are listed: an operator whose
 * edit had no effect needs to be able to see the file that is hiding it.
 */
function SubagentsTab({
  provider,
  subagents,
  onEdit,
  onCreate,
}: {
  provider: ProviderInfo;
  subagents: SubagentsState;
  onEdit: (subagent: Subagent) => void;
  onCreate: () => void;
}) {
  const { unavailable, loaded, error } = subagents;

  return (
    <div>
      <WProviderNote provider={provider} />
      {/* A provider that cannot manage subagents says so, rather than showing
          an empty list that would read as "you have none". */}
      {unavailable !== undefined && <p className="w-note">{unavailable}</p>}
      {error !== undefined && (
        <WRow activity="attention" primary="could not save" secondary={error} />
      )}
      {unavailable === undefined && loaded && subagents.subagents.length === 0 && (
        <div className="w-empty">no subagents</div>
      )}
      {subagents.subagents.map((subagent) => (
        <WRow
          key={`${subagent.scope}:${subagent.name}`}
          activity={subagent.readOnly === true ? "attention" : "idle"}
          primary={subagent.name}
          secondary={subagentSummary(subagent)}
          right={scopeLabel(subagent)}
          actions={
            <>
              {/* A file whose name no path can be composed from is the one
                  thing here that cannot be edited — but it must stay
                  removable, or the operator has no way out of it. */}
              {subagent.readOnly !== true && (
                <button className="w-btn" onClick={() => onEdit(subagent)}>
                  edit
                </button>
              )}
              <WConfirmButton
                label="remove"
                confirmLabel="confirm"
                onConfirm={() => subagents.remove(subagent.name, subagent.scope)}
              />
            </>
          }
        />
      ))}
      <div className="btn-row">
        <button
          className="w-btn"
          onClick={onCreate}
          disabled={unavailable !== undefined}
        >
          + subagent
        </button>
      </div>
    </div>
  );
}
