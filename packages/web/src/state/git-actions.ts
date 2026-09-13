/**
 * When the project window's push and pull buttons are live.
 *
 * Pure, and out here rather than inline in the component, because these two
 * are a pair of interlocking rules that are easy to get subtly wrong and
 * impossible to notice from the screen: a button that is enabled when the
 * server will refuse it teaches the operator that the buttons lie, and one
 * that stays disabled after the thing it was waiting for has happened reads as
 * broken.
 */

/** What either rule needs to know. A subset of the window's status state, so a
 * caller can hand it the whole thing. */
export interface GitActionStatus {
  dirty: boolean;
  hasRemote: boolean;
  /** Absent on a branch with no upstream to compare against. */
  ahead?: number;
  behind?: number;
}

/**
 * Push is live when there is something to send, nothing uncommitted, and
 * nothing waiting at the remote.
 *
 * - dirty: the push would ship a half-state — commits, not working changes.
 * - `ahead === 0`: the remote already has every commit.
 * - `ahead === undefined`: a branch that has never been pushed. No upstream to
 *   compare against, so `push -u` is exactly the thing to offer.
 * - `behind > 0`: the remote rejects this push outright. Holding the button is
 *   the honest version of a refusal the operator would otherwise only discover
 *   by pressing it. A successful pull releases it — the ack re-reads status,
 *   `behind` comes back 0, and push goes live in the same breath.
 */
export function canPush(status: GitActionStatus | undefined): boolean {
  if (status === undefined || status.dirty) return false;
  if (status.ahead !== undefined && status.ahead === 0) return false;
  if (status.behind !== undefined && status.behind > 0) return false;
  return true;
}

/**
 * Pull is live when the remote is holding commits this checkout does not.
 *
 * `behind` is only ever as fresh as the last fetch — but selecting a project
 * fetches its branch, so by the time this window is open it reflects the
 * remote. Dirty blocks it for the same reason the server refuses: a merge
 * cannot run over uncommitted work.
 */
export function canPull(status: GitActionStatus | undefined): boolean {
  return (
    status !== undefined &&
    status.hasRemote &&
    !status.dirty &&
    status.behind !== undefined &&
    status.behind > 0
  );
}
