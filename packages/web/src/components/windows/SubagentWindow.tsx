import { useEffect, useRef, useState } from "react";
import { SUBAGENT_NAME_PATTERN, type Subagent } from "@overseer/protocol";
import { WConfirmButton, WInline, WRow, WTitle } from "./bits";
import type { SessionOption } from "../../session";
import type { SubagentsState } from "../../state/useSubagents";

/**
 * Writing one subagent. Summoned from a row's `edit` in the capabilities
 * window, or from its `+ subagent` — never from the command bar, because you
 * edit a specific thing and so reach it through that thing
 * (design-system.md §5.1).
 *
 * The instructions box is the point of the window: a subagent is mostly prose
 * telling the model how to behave, so it gets the room, and it is an input —
 * dark ground, same material as the composer (§7.1).
 */
export function SubagentWindow({
  existing,
  subagents,
  models,
  onClose,
}: {
  /** Absent when creating. */
  existing: Subagent | undefined;
  subagents: SubagentsState;
  /** The session model menu, reused: a subagent can only run on a model this
   * provider actually offers. */
  models: SessionOption | undefined;
  onClose: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [prompt, setPrompt] = useState(existing?.prompt ?? "");
  const [model, setModel] = useState(existing?.model ?? "");
  const [tools, setTools] = useState(existing?.tools ?? "");
  const [scope, setScope] = useState(existing?.scope ?? "project");
  const [modelOpen, setModelOpen] = useState(false);
  // Gates the shared write state to this window's own request: an operator who
  // cancelled out of a failed save and reopened must not meet that stale error
  // on a form they have not touched (the `ProjectCreateWindow` contract).
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const submitting = hasSubmitted && subagents.status === "working";
  const errorMessage =
    hasSubmitted && subagents.status === "error" ? subagents.error : undefined;

  const wasSubmitting = useRef(false);
  useEffect(() => {
    if (wasSubmitting.current && !submitting && errorMessage === undefined) {
      onClose();
    }
    wasSubmitting.current = submitting;
  }, [submitting, errorMessage, onClose]);

  const trimmedName = name.trim();
  const canSubmit =
    trimmedName !== "" &&
    description.trim() !== "" &&
    prompt.trim() !== "" &&
    !submitting;

  /** Named up front rather than left to the server's refusal: the rule is
   * short enough to say, and a form that explains it beats a round trip. */
  const badName =
    trimmedName !== "" && !SUBAGENT_NAME_PATTERN.test(trimmedName);
  /** The name is the filename, so changing either of these moves the file. */
  const willRename =
    existing !== undefined &&
    (trimmedName !== existing.name || scope !== existing.scope);

  function submit() {
    if (!canSubmit) return;
    setHasSubmitted(true);
    subagents.write(
      {
        name: trimmedName,
        description: description.trim(),
        prompt,
        model,
        tools: tools.trim(),
        scope,
      },
      existing !== undefined
        ? { name: existing.name, scope: existing.scope }
        : undefined,
    );
  }

  const modelLabel =
    models?.values.find((option) => option.value === model)?.label ??
    (model === "" ? "inherit" : model);

  return (
    <div>
      <WTitle>identity</WTitle>
      <p className="w-note">
        a markdown file the provider reads: the description is what a task gets
        matched against, the instructions are what the subagent is told.
      </p>

      {(submitting || errorMessage !== undefined) && (
        <WRow
          activity={errorMessage !== undefined ? "attention" : "working"}
          primary={errorMessage !== undefined ? "failed" : "saving…"}
          secondary={errorMessage}
        />
      )}

      <div className="btn-row">
        <input
          className="w-input"
          type="text"
          value={name}
          spellCheck={false}
          autoComplete="off"
          aria-label="name"
          placeholder="name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </div>
      {badName && (
        <p className="w-note">
          names are lowercase letters, numbers and single hyphens — the name is
          also the filename.
        </p>
      )}

      <div className="btn-row">
        <input
          className="w-input"
          type="text"
          value={description}
          spellCheck={false}
          autoComplete="off"
          aria-label="description"
          placeholder="what this subagent is for"
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </div>

      {/* Only drawn when there is a choice: a provider that keeps subagents in
          one place (cursor) would otherwise show a row whose other option the
          adapter refuses. */}
      {subagents.scopes.length > 1 && (
        <>
          <WTitle>where it lives</WTitle>
          <div className="btn-row">
            {subagents.scopes.map((value) => (
              <button
                key={value}
                className="w-btn"
                title={value === "project" ? "this project only" : "every project"}
                onClick={() => setScope(value)}
              >
                <span className="w-btn-mark">{scope === value ? "▪" : ""}</span>
                {value}
              </button>
            ))}
          </div>
        </>
      )}
      {willRename && (
        <p className="w-note">
          saving moves the file — the old one is removed once the new one is
          written.
        </p>
      )}
      {existing !== undefined && !willRename && existing.renamedOnSave === true && (
        <p className="w-note">
          this file is named {existing.file.split("/").pop()} but declares{" "}
          {existing.name} — saving renames it to match.
        </p>
      )}

      <WTitle>model</WTitle>
      <div className="btn-row">
        <button className="w-btn" onClick={() => setModelOpen(!modelOpen)}>
          {modelLabel}
        </button>
      </div>
      {modelOpen && (
        <div className="loop-slot-values" role="listbox">
          {[{ value: "", label: "inherit" }, ...(models?.values ?? [])].map(
            (option) => {
              const selected = option.value === model;
              return (
                <button
                  key={option.value || "inherit"}
                  role="option"
                  aria-selected={selected}
                  className={`session-ctl-option ${selected ? "current" : ""}`}
                  onClick={() => {
                    setModel(option.value);
                    setModelOpen(false);
                  }}
                >
                  <span className="session-ctl-mark">{selected ? "▪" : ""}</span>
                  <span className="session-ctl-option-text">{option.label}</span>
                </button>
              );
            },
          )}
        </div>
      )}

      <WTitle>tools</WTitle>
      <p className="w-note">
        what this subagent may call, comma separated. Blank inherits every tool
        the session has — a subagent cannot be granted one it does not.
      </p>
      <div className="btn-row">
        <input
          className="w-input"
          type="text"
          value={tools}
          spellCheck={false}
          autoComplete="off"
          aria-label="tools"
          placeholder="Read, Edit, Bash"
          onChange={(e) => setTools(e.target.value)}
        />
      </div>

      <WTitle>instructions</WTitle>
      <textarea
        className="w-editor no-drag"
        value={prompt}
        spellCheck={false}
        aria-label="instructions"
        placeholder="You are…"
        onChange={(e) => setPrompt(e.target.value)}
      />

      {/* The path comes from the file that exists. Composing one for a
          subagent not yet written would name a location nothing has created. */}
      {existing !== undefined && (
        <>
          <WTitle>file</WTitle>
          <div className="w-pre">{existing.file}</div>
          <WInline label="scope" value={existing.scope} />
        </>
      )}

      <div className="btn-row">
        <button className="w-btn" onClick={submit} disabled={!canSubmit}>
          save
        </button>
        {existing !== undefined && (
          <WConfirmButton
            label="delete"
            confirmLabel="confirm delete"
            disabled={submitting}
            onConfirm={() => {
              setHasSubmitted(true);
              subagents.remove(existing.name, existing.scope);
            }}
          />
        )}
        <button className="w-btn" onClick={onClose}>
          cancel
        </button>
      </div>
    </div>
  );
}
