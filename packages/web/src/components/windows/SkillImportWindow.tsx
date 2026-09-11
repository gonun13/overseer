import { useEffect, useRef, useState } from "react";
import {
  SKILL_MAX_UPLOAD_FILES,
  SKILL_NAME_PATTERN,
  type SkillSource,
} from "@overseer/protocol";
import { WTitle } from "./bits";
import type { SkillsState } from "../../state/useSkills";

/**
 * Importing one skill. Summoned from the capabilities window's skills tab.
 *
 * Two sources, because they are the two an operator actually has: a skill
 * someone published, and files on their own machine. They share a scope picker
 * and a submit, and nothing else — so the window is a source toggle over two
 * small forms rather than one form with conditional fields.
 *
 * Files are read here and sent as text on the existing socket. A skill is
 * markdown and the handful of files it references, so this stays inside the
 * frame caps the protocol already defines; nothing in the app needs a binary
 * upload path yet, and adding one for this would be a transport built for a
 * payload that is mostly prose.
 */
export function SkillImportWindow({
  skills,
  onClose,
}: {
  skills: SkillsState;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"git" | "files">("git");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"project" | "user">("project");
  const [picked, setPicked] = useState<{ path: string; text: string }[]>([]);
  const [readError, setReadError] = useState<string>();
  // Gates the shared import state to this window's own request, the same
  // contract `SubagentWindow` keeps with its own `hasSubmitted`.
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const submitting = hasSubmitted && skills.status === "working";
  const errorMessage =
    hasSubmitted && skills.status === "error" ? skills.error : undefined;

  const wasSubmitting = useRef(false);
  useEffect(() => {
    if (wasSubmitting.current && !submitting && errorMessage === undefined) {
      onClose();
    }
    wasSubmitting.current = submitting;
  }, [submitting, errorMessage, onClose]);

  const trimmedName = name.trim();
  /** Named up front rather than left to the server's refusal — the rule is
   * short enough to say. Blank is fine: the skill names itself. */
  const badName = trimmedName !== "" && !SKILL_NAME_PATTERN.test(trimmedName);

  // A skill is a folder with a SKILL.md *or* a markdown file carrying a
  // description in its frontmatter. Both are real published shapes, so the form
  // accepts either and leaves the frontmatter check to the server, which reads
  // the file rather than guessing from its name.
  const hasMarkdown = picked.some(
    (file) => file.path.endsWith(".md") || file.path.endsWith(".markdown"),
  );

  const canSubmit =
    !submitting &&
    !badName &&
    (kind === "git" ? url.trim() !== "" : picked.length > 0 && hasMarkdown);

  async function onPick(list: FileList | null): Promise<void> {
    setReadError(undefined);
    if (list === null) return;
    const files = Array.from(list);
    if (files.length > SKILL_MAX_UPLOAD_FILES) {
      setReadError(`that is more than ${SKILL_MAX_UPLOAD_FILES} files`);
      return;
    }
    try {
      const read = await Promise.all(
        files.map(async (file) => ({
          // `webkitRelativePath` is set when a whole folder was picked, which
          // is how a skill with a `references/` subfolder keeps its shape. A
          // plain multi-file pick has none, and the name is the whole path.
          path:
            (file as File & { webkitRelativePath?: string }).webkitRelativePath !==
            undefined &&
            (file as File & { webkitRelativePath?: string }).webkitRelativePath !== ""
              ? stripLeadingFolder(
                  (file as File & { webkitRelativePath: string }).webkitRelativePath,
                )
              : file.name,
          text: await file.text(),
        })),
      );
      setPicked(read);
    } catch {
      setReadError("those files could not be read");
    }
  }

  function submit(): void {
    if (!canSubmit) return;
    const source: SkillSource =
      kind === "git"
        ? { kind: "git", url: url.trim() }
        : { kind: "upload", files: picked };
    setHasSubmitted(true);
    skills.importSkill({
      source,
      scope,
      ...(trimmedName !== "" ? { name: trimmedName } : {}),
    });
  }

  return (
    <div>
      <div className="btn-row">
        {(["git", "files"] as const).map((value) => (
          <button
            key={value}
            className="w-btn"
            onClick={() => setKind(value)}
            title={
              value === "git"
                ? "clone a repository"
                : "upload files from this machine"
            }
          >
            <span className="w-btn-mark">{kind === value ? "▪" : ""}</span>
            {value}
          </button>
        ))}
      </div>

      {kind === "git" ? (
        <>
          <WTitle>repository</WTitle>
          <p className="w-note">
            an https url. A link to a folder or a file inside a repository works
            as it is — the branch and path are read off it. A folder of skills
            imports all of them.
          </p>
          <div className="btn-row">
            <input
              className="w-input"
              type="text"
              value={url}
              spellCheck={false}
              autoComplete="off"
              aria-label="repository url"
              placeholder="https://github.com/owner/repo/tree/main/skills/pdf"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
        </>
      ) : (
        <>
          <WTitle>files</WTitle>
          <p className="w-note">
            a SKILL.md plus anything it references, or one .md per skill.
            Picking a folder keeps its shape, and several skills at once is
            fine.
          </p>
          <div className="btn-row">
            <input
              className="w-input no-drag"
              type="file"
              multiple
              accept=".md,.markdown,.txt,.json,.yaml,.yml"
              aria-label="skill files"
              onChange={(e) => void onPick(e.target.files)}
            />
          </div>
          {picked.length > 0 && (
            <div className="w-pre">
              {picked.map((file) => file.path).join("\n")}
            </div>
          )}
          {picked.length > 0 && !hasMarkdown && (
            <p className="w-note">
              none of those is markdown — a skill is a SKILL.md, or a .md file
              with a description in its frontmatter.
            </p>
          )}
          {readError !== undefined && <p className="w-note">{readError}</p>}
        </>
      )}

      <WTitle>name</WTitle>
      <p className="w-note">
        blank uses the name each skill gives itself — which is the only option
        when the source holds more than one.
      </p>
      <div className="btn-row">
        <input
          className="w-input"
          type="text"
          value={name}
          spellCheck={false}
          autoComplete="off"
          aria-label="name"
          placeholder="leave blank unless renaming"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </div>
      {badName && (
        <p className="w-note">
          names are lowercase letters, numbers and single hyphens — the name is
          also the folder.
        </p>
      )}

      {/* Only drawn when there is a choice, the same rule the subagent form
          follows. */}
      {skills.scopes.length > 1 && (
        <>
          <WTitle>where it lives</WTitle>
          <div className="btn-row">
            {skills.scopes.map((value) => (
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

      {errorMessage !== undefined && <p className="w-note">{errorMessage}</p>}

      <div className="btn-row">
        <button className="w-btn" onClick={submit} disabled={!canSubmit}>
          {submitting ? "importing…" : "import"}
        </button>
        <button className="w-btn" onClick={onClose}>
          cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Drop the folder the operator picked, keeping the structure under it.
 *
 * A folder pick reports `my-skill/SKILL.md`; the skill *is* that folder, so the
 * path inside it is what the importer wants. A nested file keeps its nesting:
 * `my-skill/references/api.md` becomes `references/api.md`.
 */
function stripLeadingFolder(relative: string): string {
  const parts = relative.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : relative;
}
