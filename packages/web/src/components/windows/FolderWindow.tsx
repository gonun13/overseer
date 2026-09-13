import { useEffect, useMemo, useState } from "react";
import type { ClientMessage, GitDirEntry, ServerMessage } from "@overseer/protocol";
import { GIT_MAX_DIR_ENTRIES } from "@overseer/protocol";
import { parseFolderViewKey } from "../../fileview";
import { FILE_TONE } from "../../status";
import { WRow, WTitle } from "./bits";

/**
 * One folder of a project's worktree — the changed files and folders directly
 * inside it.
 *
 * Opened by clicking a folder row in the project window. Git reports an
 * untracked directory as a single collapsed row rather than as its files, so
 * that row has to open into something; a diff of a directory is not a thing,
 * and this is. A folder row here opens another one of these, which is what
 * makes the walk go as deep as the tree does, and a file row opens the file
 * view the project window's own file rows open.
 *
 * The list is what a commit made from the project window would take from this
 * folder — the same framing the file view carries. So an ignored or unchanged
 * child is absent by design rather than missing.
 *
 * Read once when it opens. It does not follow the folder: an agent writing
 * underneath it leaves the window stale, and the way to refresh is to close
 * and open it again — the same contract the file view has.
 */
export function FolderWindow({
  target,
  send,
  subscribe,
  onOpenFile,
  onOpenFolder,
}: {
  target: string;
  send: (message: ClientMessage) => void;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
  /** Open one child file's view. Handed the child's name — the window it
   * opens needs the whole path, and only the caller knows how to build one. */
  onOpenFile: (name: string) => void;
  /** Open one child folder's listing, on the same terms. */
  onOpenFolder: (name: string) => void;
}) {
  const view = useMemo(() => parseFolderViewKey(target), [target]);
  const [shown, setShown] = useState<{
    entries: GitDirEntry[];
    truncated: boolean;
  }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!view) return;
    return subscribe((frame) => {
      if (
        frame.type === "project.git.list" &&
        frame.path === view.projectPath &&
        frame.folder === view.folder
      ) {
        setError(undefined);
        setShown({ entries: frame.entries, truncated: frame.truncated });
        return;
      }
      if (frame.type === "error" && frame.about === "project.git.list") {
        setError(frame.message);
      }
    });
  }, [view, subscribe]);

  useEffect(() => {
    if (!view) return;
    setShown(undefined);
    setError(undefined);
    send({
      type: "project.git.list",
      path: view.projectPath,
      folder: view.folder,
    });
  }, [view, send]);

  if (!view) {
    return (
      <div>
        <div className="w-empty">no folder</div>
      </div>
    );
  }

  return (
    <div>
      <WTitle>project · folder</WTitle>
      <div className="w-path">{view.folder}/</div>

      {error !== undefined && (
        <WRow activity="attention" primary="failed" secondary={error} />
      )}

      {error === undefined && shown === undefined && (
        <p className="w-note">reading…</p>
      )}

      {shown !== undefined && shown.entries.length === 0 && (
        <div className="w-empty">nothing to commit in this folder</div>
      )}

      {shown?.entries.map((entry) => (
        <WRow
          key={`${entry.kind}:${entry.name}`}
          activity="idle"
          // A folder wears the slash git prints on one, so the two kinds are
          // told apart by the name itself rather than by their ink — which is
          // already spoken for by the file's fate.
          primary={entry.kind === "dir" ? `${entry.name}/` : entry.name}
          // A folder whose children disagree has no one status to report, and
          // says so rather than picking one of them.
          right={entry.status ?? "mixed"}
          {...(entry.status ? { tone: FILE_TONE[entry.status] } : {})}
          onClick={() =>
            entry.kind === "dir" ? onOpenFolder(entry.name) : onOpenFile(entry.name)
          }
        />
      ))}

      {shown?.truncated === true && (
        <p className="w-note">
          truncated · showing the first {GIT_MAX_DIR_ENTRIES} entries.
        </p>
      )}
    </div>
  );
}
