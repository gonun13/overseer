import { useEffect, useMemo, useState } from "react";
import type { ClientMessage, ServerMessage } from "@overseer/protocol";
import { GIT_MAX_DIFF_LINES } from "@overseer/protocol";
import { parseFileViewKey } from "../../fileview";
import { WRow, WTitle, WUnavailable } from "./bits";

type Mode = "diff" | "content";

/** What a diff line is, which is all the ink it gets. Classified by prefix in
 * the order git can emit them — the `+++`/`---` file headers have to be caught
 * before the bare `+`/`-` content lines they otherwise look exactly like. */
type DiffLineKind = "add" | "del" | "hunk" | "meta" | "ctx";

const META =
  /^(diff |index |old mode|new mode|new file|deleted file|similarity |dissimilarity |rename |copy |Binary files )/;

function classify(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (META.test(line)) return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  // `\ No newline at end of file` lands here, which is where it reads best:
  // it is a note about the line above, not a change of its own.
  return "ctx";
}

/**
 * One file from a project's worktree — its diff against the last commit, or
 * its current contents.
 *
 * Opened by clicking a changed file in the project window. The diff is against
 * `HEAD` rather than the index because the project window's commit button
 * stages everything first, so this is exactly the change a commit from there
 * would record.
 *
 * Also still opened from a tool turn's inspect control, which passes a bare
 * target with no project attached to it. That case cannot be read — there is
 * no project to resolve the path against — so it keeps the note it has always
 * carried rather than pretending to be empty.
 *
 * The view is read once when it opens and once per toggle. It does not follow
 * the file: an agent editing underneath it leaves the window stale, and the
 * way to refresh is to close and open it again.
 */
export function DiffWindow({
  target,
  send,
  subscribe,
}: {
  target: string;
  send: (message: ClientMessage) => void;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
}) {
  const view = useMemo(() => parseFileViewKey(target), [target]);
  const [mode, setMode] = useState<Mode>("diff");
  const [shown, setShown] = useState<{
    mode: Mode;
    text: string;
    truncated: boolean;
  }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!view) return;
    return subscribe((frame) => {
      if (
        frame.type === "project.git.show" &&
        frame.path === view.projectPath &&
        frame.file === view.file
      ) {
        setError(undefined);
        setShown({ mode: frame.mode, text: frame.text, truncated: frame.truncated });
        return;
      }
      if (frame.type === "error" && frame.about === "project.git.show") {
        setError(frame.message);
      }
    });
  }, [view, subscribe]);

  useEffect(() => {
    if (!view) return;
    // Clear first: a body from the previous mode sitting under a pending
    // request would read as an answer to it.
    setShown(undefined);
    setError(undefined);
    send({
      type: "project.git.show",
      path: view.projectPath,
      file: view.file,
      mode,
      ...(view.previousPath ? { previousPath: view.previousPath } : {}),
    });
  }, [view, mode, send]);

  if (!view) {
    return (
      <div>
        <WUnavailable detail="tool input is not parsed into a diff yet." />
        <div className="w-path">{target}</div>
      </div>
    );
  }

  // Only render a body that answers the mode currently selected. The operator
  // can flip faster than the reads come back, and the reply echoes its own
  // mode precisely so a late answer to the previous question is ignored rather
  // than shown under the new one.
  const body = shown?.mode === mode ? shown : undefined;

  return (
    <div>
      <WTitle>project · file</WTitle>
      <div className="w-path">{view.file}</div>

      <div className="btn-row">
        {(
          [
            ["diff", "changes since the last commit"],
            ["content", "the file as it is now"],
          ] as const
        ).map(([value, help]) => (
          <button
            key={value}
            type="button"
            className="w-btn"
            title={help}
            onClick={() => setMode(value)}
          >
            <span className="w-btn-mark">{mode === value ? "▪" : ""}</span>
            {value === "content" ? "file" : value}
          </button>
        ))}
      </div>

      {error !== undefined && (
        <WRow activity="attention" primary="failed" secondary={error} />
      )}

      {error === undefined && body === undefined && (
        <p className="w-note">reading…</p>
      )}

      {body !== undefined && body.text.trim() === "" && (
        <div className="w-empty">
          {mode === "diff" ? "no changes in this file" : "empty file"}
        </div>
      )}

      {body !== undefined &&
        body.text.trim() !== "" &&
        (mode === "content" ? (
          <div className="w-pre">{body.text}</div>
        ) : (
          <div className="w-pre w-diff">
            {body.text.split("\n").map((line, index) => (
              <span
                // Lines are not reordered or filtered — the index is the line
                // number, which is as stable an identity as a diff line has.
                key={index}
                className={`w-diff-line is-${classify(line)}`}
              >
                {line === "" ? "\u00a0" : line}
              </span>
            ))}
          </div>
        ))}

      {body?.truncated === true && (
        <p className="w-note">
          truncated · showing the first {GIT_MAX_DIFF_LINES} lines.
        </p>
      )}
    </div>
  );
}
