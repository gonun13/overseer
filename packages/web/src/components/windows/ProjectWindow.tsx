import { useEffect, useState } from "react";
import type { ClientMessage, GitFileChange, ServerMessage } from "@overseer/protocol";
import { WInline, WRow, WTitle } from "./bits";

interface GitStatusState {
  branch: string;
  dirty: boolean;
  hasRemote: boolean;
  ahead?: number;
  behind?: number;
  files: GitFileChange[];
}

type Busy = "commit" | "push" | "merge" | "revert" | null;

/**
 * Commit, push, merge, and revert for one project's git worktree — opened
 * from the project panel's per-row manage icon (payload: that project's
 * path) or the `/project` command, which targets the active project.
 *
 * Push and merge are mutually exclusive on purpose: a remote implies a PR
 * process upstream, so merge-to-main is only offered when there is none to
 * defer to.
 */
export function ProjectWindow({
  path,
  send,
  subscribe,
}: {
  path: string;
  send: (message: ClientMessage) => void;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
}) {
  const [status, setStatus] = useState<GitStatusState>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<Busy>(null);
  const [confirming, setConfirming] = useState<"merge" | "revert" | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!path) return;
    return subscribe((frame) => {
      if (frame.type === "project.git.status" && frame.path === path) {
        const { branch, dirty, hasRemote, ahead, behind, files } = frame;
        setStatus({ branch, dirty, hasRemote, ahead, behind, files });
        return;
      }
      if (
        (frame.type === "project.git.committed" ||
          frame.type === "project.git.pushed" ||
          frame.type === "project.git.merged" ||
          frame.type === "project.git.reverted") &&
        frame.path === path
      ) {
        setBusy(null);
        setConfirming(null);
        setError(undefined);
        if (frame.type === "project.git.committed") setMessage("");
        // No inline result payload on any of these acks — re-ask for the
        // fresh file list/branch rather than guessing what changed.
        send({ type: "project.git.status", path });
        return;
      }
      if (frame.type === "error" && frame.about?.startsWith("project.git.")) {
        setBusy(null);
        setError(frame.message);
        // A failed merge can still have checked out `main` before the merge
        // commit itself failed — re-read rather than leave a stale branch on
        // screen. Guarded against `project.git.status` itself to avoid
        // looping if the read keeps failing.
        if (frame.about !== "project.git.status") {
          send({ type: "project.git.status", path });
        }
      }
    });
  }, [path, subscribe, send]);

  useEffect(() => {
    if (!path) return;
    send({ type: "project.git.status", path });
  }, [path, send]);

  if (!path) {
    return <div className="w-empty">no active project</div>;
  }

  function commit() {
    if (!path || message.trim() === "") return;
    setBusy("commit");
    setError(undefined);
    send({ type: "project.git.commit", path, message: message.trim() });
  }

  return (
    <div>
      <WTitle>project · git</WTitle>

      {status === undefined && error === undefined && (
        <p className="w-note">reading status…</p>
      )}
      {error !== undefined && (
        <WRow activity="attention" primary="failed" secondary={error} />
      )}

      {status !== undefined && (
        <>
          <WInline label="branch" value={status.branch} />
          {(status.ahead !== undefined || status.behind !== undefined) && (
            <WInline
              label="tracking"
              value={`${status.ahead ?? 0} ahead · ${status.behind ?? 0} behind`}
            />
          )}
          <WInline label="remote" value={status.hasRemote ? "attached" : "none"} />

          {status.files.length === 0 ? (
            <div className="w-empty">clean — nothing changed</div>
          ) : (
            status.files.map((file) => (
              <WRow
                key={file.path}
                activity="idle"
                primary={file.path}
                right={file.status}
              />
            ))
          )}

          <div className="btn-row">
            <input
              className="w-input"
              type="text"
              value={message}
              spellCheck={false}
              autoComplete="off"
              placeholder="commit message"
              aria-label="commit message"
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit();
              }}
            />
            <button
              type="button"
              className="w-btn"
              disabled={!status.dirty || message.trim() === "" || busy !== null}
              onClick={commit}
            >
              {busy === "commit" ? "committing…" : "commit"}
            </button>
          </div>

          {confirming === null && (
            <div className="btn-row">
              {status.hasRemote ? (
                <button
                  type="button"
                  className="w-btn"
                  disabled={busy !== null}
                  onClick={() => {
                    setBusy("push");
                    setError(undefined);
                    send({ type: "project.git.push", path });
                  }}
                >
                  {busy === "push" ? "pushing…" : "push"}
                </button>
              ) : (
                status.branch !== "main" && (
                  <button
                    type="button"
                    className="w-btn"
                    disabled={busy !== null}
                    onClick={() => setConfirming("merge")}
                  >
                    merge to main…
                  </button>
                )
              )}
              <button
                type="button"
                className="w-btn danger"
                disabled={busy !== null || !status.dirty}
                onClick={() => setConfirming("revert")}
              >
                revert…
              </button>
            </div>
          )}
          {status.hasRemote && (
            <p className="w-note">merge happens through the PR process upstream.</p>
          )}

          {confirming === "merge" && (
            <div className="btn-row">
              <span className="w-note">
                merge {status.branch} into main — cannot be undone.
              </span>
              <button
                type="button"
                className="w-btn danger"
                onClick={() => {
                  setBusy("merge");
                  setError(undefined);
                  send({ type: "project.git.merge", path });
                }}
              >
                confirm
              </button>
              <button
                type="button"
                className="w-btn"
                onClick={() => setConfirming(null)}
              >
                cancel
              </button>
            </div>
          )}
          {confirming === "revert" && (
            <div className="btn-row">
              <span className="w-note">
                discard every uncommitted change — cannot be undone.
              </span>
              <button
                type="button"
                className="w-btn danger"
                onClick={() => {
                  setBusy("revert");
                  setError(undefined);
                  send({ type: "project.git.revert", path });
                }}
              >
                confirm
              </button>
              <button
                type="button"
                className="w-btn"
                onClick={() => setConfirming(null)}
              >
                cancel
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
