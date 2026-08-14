import type {
  AuthStateMessage,
  LoginHandle,
  LoginUpdate,
} from "@overseer/protocol";
import { getAdapter } from "./adapters.js";
import { recordAction, setAdapterAuthenticated } from "./memory/internal.js";

/**
 * The login broker: at most **one** live login per process.
 *
 * Same reasoning as the discovery single-flight guard in `ws.ts`, for a
 * sharper reason. Each `claude auth login` spawn mints its own PKCE challenge
 * and `state`, and the URL it printed is redeemable only by *that* process. Two
 * tabs each spawning one leaves the operator looking at one URL while the other
 * process holds the matching challenge, and the paste fails with a message that
 * blames their copy/paste.
 *
 * So a second asker **joins**: it is replayed the current state, URL included,
 * rather than refused. A refusal it cannot act on would leave that tab watching
 * a flow that never resolves.
 *
 * What this module does *not* do: open a socket, serve a route, or look at a
 * port. The CLI does open a loopback listener during a login, and it is a trap
 * — one GET to it with a wrong `state` kills the login in flight (verified:
 * "Login failed: Invalid state parameter", exit 1). Nothing in this process may
 * probe local ports while a login is running.
 *
 * Log hygiene: the verification URL is a PKCE challenge and the pasted code is
 * a live grant. Neither reaches the action register or the operations window —
 * what is recorded is that a login started and how it ended, nothing carried in
 * it.
 */

type Broadcast = (message: AuthStateMessage) => void;

interface LiveLogin {
  adapterId: string;
  handle: LoginHandle;
  /** The last frame broadcast, kept verbatim so a joiner is replayed exactly
   * what everyone else already has. */
  last: AuthStateMessage;
}

let live: LiveLogin | undefined;

/**
 * The last *settled* outcome, so a tab that connects after a login finished is
 * not left reading the status discovery saw at boot until the next pass.
 *
 * Only outcomes that carry a status worth replaying are kept — a completed
 * login and a sign-out. A failure is deliberately not: the tabs that were
 * watching the flow already saw the reason, and handing "login failed" to a
 * tab opened an hour later would report a transient event as the current state
 * of the world. Cleared when a new login starts.
 */
let lastSettled: AuthStateMessage | undefined;

export type LoginRefusal = { ok: false; reason: string };
export type LoginAccepted = { ok: true };
export type LoginResult = LoginAccepted | LoginRefusal;

/** The frame a freshly-connected socket should be handed, if there is one. */
export function currentAuthState(): AuthStateMessage | undefined {
  return live?.last ?? lastSettled;
}

function toFrame(adapterId: string, update: LoginUpdate): AuthStateMessage {
  return {
    type: "auth.state",
    adapterId,
    phase: update.phase,
    ...(update.verificationUrl !== undefined
      ? { verificationUrl: update.verificationUrl }
      : {}),
    ...(update.detail !== undefined ? { detail: update.detail } : {}),
    ...(update.retryable !== undefined ? { retryable: update.retryable } : {}),
    ...(update.status !== undefined ? { status: update.status } : {}),
  };
}

/**
 * Start a login, or join the one already running.
 *
 * `replay` is the asking socket's own `send`, and it is used on the *join* path
 * only: a tab arriving mid-flow needs the current state on its own socket
 * immediately, because the frame carrying it was broadcast before it asked.
 * Everything else goes out on `broadcast`, since a login finished in one tab
 * has to land in every tab.
 */
export function startLogin(
  adapterId: string,
  broadcast: Broadcast,
  replay: Broadcast,
): LoginResult {
  if (live !== undefined) {
    if (live.adapterId !== adapterId) {
      return {
        ok: false,
        reason: `a login for ${live.adapterId} is already running`,
      };
    }
    replay(live.last);
    return { ok: true };
  }

  const adapter = getAdapter(adapterId);
  if (adapter === undefined)
    return { ok: false, reason: `unknown adapter: ${adapterId}` };
  if (adapter.login === undefined || !adapter.capabilities.login) {
    return {
      ok: false,
      reason: `${adapterId} cannot sign in from the console`,
    };
  }

  lastSettled = undefined;

  // The driver emits `starting` synchronously inside `start`, before `live` can
  // exist — so the latest frame is tracked here and `live` adopts it after.
  // (`replay` is not used on this path: the asking socket is one of the clients
  // `broadcast` reaches, and sending it twice would double every opening frame.)
  let latest: AuthStateMessage = {
    type: "auth.state",
    adapterId,
    phase: "starting",
  };
  const publish = (update: LoginUpdate) => {
    latest = toFrame(adapterId, update);
    if (live !== undefined) live.last = latest;
    if (update.phase === "success") lastSettled = latest;
    broadcast(latest);
  };

  const handle = adapter.login.start(publish);
  live = { adapterId, handle, last: latest };

  void handle.done
    .then(async (status) => {
      // The one fact worth keeping: whether this instance is signed in. It
      // rides in the world snapshot the adapters already occupy, so nothing new
      // is invented — and it is what lets a *later* `authenticated: false` be
      // told apart from never having signed in at all.
      await setAdapterAuthenticated(adapterId, status.authenticated);
      await recordAction({
        actor: "operator",
        action: "adapter:login",
        outcome: status.authenticated ? "ok" : "blocked",
        // Neither the URL nor the code. Only how it ended.
        detail: status.authenticated
          ? adapterId
          : `${adapterId} · not signed in`,
      });
    })
    .finally(() => {
      live = undefined;
    });

  return { ok: true };
}

/** Relay the operator's paste into the child's stdin. Verbatim — this function
 * deliberately does nothing to the string. */
export function submitCode(code: string): LoginResult {
  if (live === undefined) return { ok: false, reason: "no login is running" };
  live.handle.submitCode(code);
  return { ok: true };
}

export function cancelLogin(): LoginResult {
  if (live === undefined) return { ok: false, reason: "no login is running" };
  live.handle.cancel();
  return { ok: true };
}

/**
 * `claude auth logout`, then re-ask what the status actually is. Idempotent:
 * signing out twice is not an error, and neither is signing out when never
 * signed in.
 */
export async function signOut(
  adapterId: string,
  broadcast: Broadcast,
): Promise<LoginResult> {
  const adapter = getAdapter(adapterId);
  if (adapter === undefined)
    return { ok: false, reason: `unknown adapter: ${adapterId}` };
  if (adapter.login === undefined || !adapter.capabilities.login) {
    return {
      ok: false,
      reason: `${adapterId} cannot sign out from the console`,
    };
  }

  // A login in flight is now moot — tear it down before the credentials it is
  // racing for stop being wanted.
  if (live !== undefined && live.adapterId === adapterId) live.handle.cancel();

  await adapter.login.signOut();
  const status = await adapter.getStatus();

  // Deliberate, so it must not read as an expiry on the next boot: clear the
  // remembered "was signed in" rather than leaving it to look like a token
  // that died on its own.
  await setAdapterAuthenticated(adapterId, status.authenticated);
  await recordAction({
    actor: "operator",
    action: "adapter:signout",
    outcome: status.authenticated ? "failed" : "ok",
    detail: adapterId,
  });

  const frame: AuthStateMessage = {
    type: "auth.state",
    adapterId,
    phase: "idle",
    status,
  };
  lastSettled = frame;
  broadcast(frame);
  return { ok: true };
}
