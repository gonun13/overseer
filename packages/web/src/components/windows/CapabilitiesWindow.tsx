import { useState } from "react";
import type { Skill, Subagent } from "@overseer/protocol";
import { WConfirmButton, WProviderNote, WRow, WUnavailable } from "./bits";
import type { ProviderInfo } from "../../domain";
import type { SkillsState } from "../../state/useSkills";
import type { SubagentsState } from "../../state/useSubagents";
import { skillKey, skillScopeLabel, skillSummary } from "../../skills";
import { scopeLabel, subagentSummary } from "../../subagents";

/**
 * MCP servers, skills and subagents for the attached provider.
 *
 * Three tabs rather than one list: they are three different things, kept in
 * three different places. A single list would have to explain that in a
 * sentence covering all three; a tab can simply be honest about itself — which
 * is still what the mcp tab does, being the one that reads nothing yet.
 *
 * Subagents open first — landing on the dead tab would make a window that
 * works read as one that does not.
 */
export function CapabilitiesWindow({
  provider,
  subagents,
  skills,
  onEdit,
  onCreate,
  onImportSkill,
}: {
  provider: ProviderInfo;
  subagents: SubagentsState;
  skills: SkillsState;
  onEdit: (subagent: Subagent) => void;
  onCreate: () => void;
  onImportSkill: () => void;
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
        <SkillsTab
          provider={provider}
          skills={skills}
          onImport={onImportSkill}
        />
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

/**
 * The operator's own skill folders, from both scopes.
 *
 * Two things here have no counterpart in the subagents tab, both because a
 * skill is a directory rather than a file:
 *
 * - There is no edit. A skill is a tree — prose, scripts, references — and the
 *   window that could edit one honestly is not this one. Import and remove are
 *   the whole surface, so the button says import rather than `+ skill`.
 * - A row may be `foreign`: found in another provider's config directory, which
 *   this provider's CLI reads but this provider does not own. Those are listed
 *   because the session will act on them, and their remove is withheld because
 *   removing one would take it out from under the provider that does own it.
 */
function SkillsTab({
  provider,
  skills,
  onImport,
}: {
  provider: ProviderInfo;
  skills: SkillsState;
  onImport: () => void;
}) {
  const { unavailable, loaded, error } = skills;

  return (
    <div>
      <WProviderNote provider={provider} />
      {/* Held at the top of the scrolling body rather than left below the
          list. One import can land a whole collection, and the moment the list
          is long is the moment the control that made it long scrolls out of
          reach. */}
      <div className="btn-row pinned">
        <button
          className="w-btn"
          onClick={onImport}
          disabled={unavailable !== undefined}
        >
          import skill
        </button>
      </div>
      {/* A provider that cannot manage skills says so, rather than showing an
          empty list that would read as "you have none". */}
      {unavailable !== undefined && <p className="w-note">{unavailable}</p>}
      {error !== undefined && (
        <WRow
          activity="attention"
          primary="could not import"
          secondary={error}
          secondaryLines={2}
        />
      )}
      {unavailable === undefined && loaded && skills.skills.length === 0 && (
        <div className="w-empty">no skills</div>
      )}
      {skills.skills.map((skill: Skill) => (
        <WRow
          key={skillKey(skill)}
          activity={
            skill.readOnly === true || skill.foreign !== undefined
              ? "attention"
              : "idle"
          }
          primary={skill.name}
          // The description is what a task gets matched against, so it is the
          // line an operator actually reads to tell two skills apart.
          secondary={skillSummary(skill)}
          secondaryLines={2}
          right={skillScopeLabel(skill)}
          actions={
            skill.foreign === undefined ? (
              <WConfirmButton
                label="remove"
                confirmLabel="confirm"
                onConfirm={() => skills.remove(skill.name, skill.scope)}
              />
            ) : undefined
          }
        />
      ))}
    </div>
  );
}
