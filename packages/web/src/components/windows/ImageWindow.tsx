import { useEffect, useMemo, useState } from "react";
import type { ClientMessage, ServerMessage } from "@overseer/protocol";
import { parseFileViewKey } from "../../fileview";
import { WRow, WTitle } from "./bits";

/** Bytes as the operator reads them: one decimal past a kilobyte. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One image from a project's worktree, drawn as it is on disk now.
 *
 * Opened instead of the file view when the operator clicks a changed file
 * whose name is an image (`imageMimeType`): git's diff of one is a single
 * "binary files differ" line, and the picture is what the click is asking
 * for. A window like every other — dismissed by ✕ or `Esc`, never modal.
 *
 * Read once on open, like the file view; reopening is the refresh.
 */
export function ImageWindow({
  target,
  send,
  subscribe,
}: {
  target: string;
  send: (message: ClientMessage) => void;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
}) {
  const view = useMemo(() => parseFileViewKey(target), [target]);
  const [image, setImage] = useState<{ src: string; bytes: number }>();
  const [size, setSize] = useState<{ w: number; h: number }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!view) return;
    return subscribe((frame) => {
      if (
        frame.type === "project.git.image" &&
        frame.path === view.projectPath &&
        frame.file === view.file
      ) {
        setError(undefined);
        setImage({
          src: `data:${frame.mime};base64,${frame.data}`,
          bytes: frame.bytes,
        });
        return;
      }
      if (frame.type === "error" && frame.about === "project.git.image") {
        setError(frame.message);
      }
    });
  }, [view, subscribe]);

  useEffect(() => {
    if (!view) return;
    send({
      type: "project.git.image",
      path: view.projectPath,
      file: view.file,
    });
  }, [view, send]);

  if (!view) {
    return <div className="w-empty">no image to show</div>;
  }

  return (
    <div>
      <WTitle>project · image</WTitle>
      <div className="w-path">{view.file}</div>

      {error !== undefined && (
        <WRow activity="attention" primary="failed" secondary={error} />
      )}

      {error === undefined && image === undefined && (
        <p className="w-note">reading…</p>
      )}

      {image !== undefined && (
        <>
          <img
            className="w-image"
            src={image.src}
            alt={view.file}
            onLoad={(event) =>
              setSize({
                w: event.currentTarget.naturalWidth,
                h: event.currentTarget.naturalHeight,
              })
            }
            onError={() => setError("the browser could not draw this file")}
          />
          <p className="w-note">
            {size !== undefined ? `${size.w} × ${size.h} · ` : ""}
            {formatBytes(image.bytes)}
          </p>
        </>
      )}
    </div>
  );
}
