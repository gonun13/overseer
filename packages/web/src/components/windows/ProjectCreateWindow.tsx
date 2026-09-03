import { useEffect, useRef, useState } from "react";
import { slugify } from "@overseer/protocol";
import type { DiscoveryController } from "../../state/useDiscovery";
import { WRow, WTitle } from "./bits";

/**
 * The create-project form. Opened from the project panel's own
 * "+ create project" row (the panel is the only surface with a project list
 * on screen, same reasoning `SessionPanel`'s "+ new session" follows).
 *
 * The folder field starts as a live slug of the name and stops following it
 * the moment the operator edits folder directly — a one-way handoff from
 * auto-derived to operator-owned, not a two-way sync.
 */
export function ProjectCreateWindow({
  wizard,
  onClose,
}: {
  wizard: DiscoveryController;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [folderTouched, setFolderTouched] = useState(false);
  const [description, setDescription] = useState("");
  // Gates `projectCreate` reads to this window's own request: the wizard's
  // create-project state outlives this component (an operator who cancelled
  // out of a failed attempt and reopens the form must not see that stale
  // error on a form they have not touched yet).
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const submitting = hasSubmitted && wizard.projectCreate.status === "working";
  const errorMessage =
    hasSubmitted && wizard.projectCreate.status === "error"
      ? wizard.projectCreate.message
      : undefined;

  const wasSubmitting = useRef(false);
  useEffect(() => {
    if (wasSubmitting.current && !submitting && errorMessage === undefined) {
      onClose();
    }
    wasSubmitting.current = submitting;
  }, [submitting, errorMessage, onClose]);

  const canSubmit = name.trim() !== "" && folder.trim() !== "" && !submitting;

  function submit() {
    if (!canSubmit) return;
    setHasSubmitted(true);
    wizard.createProject({
      name: name.trim(),
      folder: folder.trim(),
      description,
    });
  }

  return (
    <div>
      <WTitle>create project</WTitle>
      <p className="w-note">
        makes /workspace/&lt;folder&gt;, runs git init in it, and writes a
        README from the name and description.
      </p>

      {(submitting || errorMessage !== undefined) && (
        <WRow
          activity={errorMessage !== undefined ? "attention" : "working"}
          primary={errorMessage !== undefined ? "failed" : "creating…"}
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
          placeholder="name"
          aria-label="project name"
          onChange={(event) => {
            const value = event.target.value;
            setName(value);
            if (!folderTouched) setFolder(slugify(value));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      </div>

      <div className="btn-row">
        <input
          className="w-input"
          type="text"
          value={folder}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="folder"
          aria-label="folder name"
          onChange={(event) => {
            setFolderTouched(true);
            setFolder(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      </div>

      <textarea
        className="w-editor no-drag"
        value={description}
        placeholder="brief description for the README"
        aria-label="project description"
        onChange={(event) => setDescription(event.target.value)}
      />

      <div className="btn-row">
        <button
          type="button"
          className="w-btn"
          disabled={!canSubmit}
          onClick={submit}
        >
          create
        </button>
        <button type="button" className="w-btn" onClick={onClose}>
          cancel
        </button>
      </div>
    </div>
  );
}
