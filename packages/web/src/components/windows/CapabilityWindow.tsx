import { useState } from "react";
import { WInline, WTitle } from "./bits";
import type { CapabilityDraft } from "../../domain";

const BLANK_CAPABILITY_DRAFT: CapabilityDraft = {
  name: "",
  kind: "",
  description: "",
  instructions: "",
  model: "",
  tools: [],
  file: "",
};

/**
 * Editing one skill or subagent. Summoned from a row's `edit` in the
 * capabilities window, never from the command bar — you edit a specific thing,
 * so you reach it through that thing (design-system.md §5.1).
 *
 * The instructions box is the point of the window: a skill or subagent is
 * mostly prose telling the model how to behave, so it gets the room, and it is
 * an input — dark ground, same material as the composer (§7.1).
 */
export function CapabilityWindow({ name }: { name: string }) {
  const draft = BLANK_CAPABILITY_DRAFT;
  const [instructions, setInstructions] = useState(draft.instructions);
  const [tools, setTools] = useState(draft.tools);

  function toggleTool(toolName: string) {
    setTools((current) =>
      current.map((t) =>
        t.name === toolName ? { ...t, enabled: !t.enabled } : t,
      ),
    );
  }

  return (
    <div>
      <WTitle>identity</WTitle>
      <WInline label="name" value={name || draft.name} />
      <WInline label="kind" value={draft.kind} />
      <WInline label="model" value={draft.model} />
      <WInline label="description" value={draft.description} />

      <WTitle>instructions</WTitle>
      <textarea
        className="w-editor no-drag"
        value={instructions}
        spellCheck={false}
        onChange={(e) => setInstructions(e.target.value)}
        aria-label="instructions"
      />

      <WTitle>tools</WTitle>
      <p className="w-note">
        what this {draft.kind || "capability"} may call. A subagent cannot be
        granted a tool the session itself does not have.
      </p>
      <div className="btn-row">
        {tools.map((tool) => (
          <button
            key={tool.name}
            className="w-btn"
            onClick={() => toggleTool(tool.name)}
          >
            <span className="w-btn-mark">{tool.enabled ? "▪" : ""}</span>
            {tool.name}
          </button>
        ))}
      </div>

      {/* The path comes from the draft. Composing one here would invent a
          location on disk that nothing has created. */}
      {draft.file && (
        <>
          <WTitle>file</WTitle>
          <div className="w-pre">{draft.file}</div>
        </>
      )}

      <div className="btn-row">
        <button className="w-btn">save</button>
        <button className="w-btn">reveal file</button>
        <button className="w-btn danger">delete</button>
      </div>
    </div>
  );
}
