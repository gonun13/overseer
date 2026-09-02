import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { AdapterStatus, LoginHandle, LoginUpdate } from "@overseer/protocol";

/**
 * Every point of contact with the `agent` CLI's *undocumented* surface lives
 * in this package, and nowhere else.
 *
 * The prompt strings below are scraped from a pinned build
 * (`2026.08.31-4057e58`, see the Dockerfile's `CURSOR_VERSION`) and are not
 * part of any contract Cursor publishes. Captured safely: `agent`'s auth
 * state is keyed off `$HOME` (verified — `HOME=/tmp/x agent status` reports
 * unauthenticated regardless of the real account), so `agent login` was run
 * for real under a throwaway `$HOME`, never against the operator's own
 * signed-in account.
 *
 * Verified shape, under `NO_OPEN_BROWSER=1` on a plain pipe (no PTY —
 * `agent login`'s output is plain lines even though the CLI is Ink-based
 * elsewhere; it degrades cleanly off a TTY):
 *
 *   Starting login process...
 *   Authenticating with Cursor...
 *   Waiting for browser authentication...
 *   Open a browser and navigate to this link: <url>
 *
 * Then nothing further was observed before the capture's timeout — no code
 * to paste back. This is a poll-until-authorized flow, not claude-code's
 * paste-a-code one: `submitCode` has nothing to do (see below). The actual
 * success/cancel/failure lines past that point were **not** captured —
 * completing them would have required a real browser to authorize against,
 * which this environment does not have. `done` therefore never trusts the
 * exit code (unverified whether cancel and success both exit 0, as they do
 * for claude-code) — it re-asks `agent status --format json`, the same
 * caution claude-code's login.ts applies for a proven reason.
 */

// ---- the CLI's surface, in one place --------------------------------------

const URL_LINE = /^Open a browser and navigate to this link:\s*(\S+)$/;

const CLI = "agent";

const run = promisify(execFile);

// ---- timeouts -------------------------------------------------------------

/** No URL by now means the output shape changed — captured live, the URL
 * line is the fourth of four lines printed within the first second. */
const URL_TIMEOUT_MS = 30_000;

/** A login left sitting at the browser-wait holds the single-flight slot
 * forever without this. */
const IDLE_TIMEOUT_MS = 10 * 60_000;

/** How long a signalled child gets to exit before a forced kill. */
const KILL_GRACE_MS = 5_000;

// ---- auth status ----------------------------------------------------------

interface StatusPayload {
  isAuthenticated?: unknown;
  userInfo?: { email?: unknown };
}

/** What `agent status --format json` answers with, verified live for both
 * the signed-in and signed-out shapes. Never throws. */
export async function readAuthStatus(): Promise<AdapterStatus> {
  let version: string | undefined;
  try {
    const { stdout } = await run(CLI, ["--version"], { timeout: 5_000 });
    version = stdout.trim();
  } catch {
    return {
      authenticated: false,
      reachable: false,
      detail: "agent CLI not found on PATH",
    };
  }

  let raw: string;
  try {
    const { stdout } = await run(CLI, ["status", "--format", "json"], {
      timeout: 10_000,
    });
    raw = stdout;
  } catch (error) {
    const stdout = (error as { stdout?: unknown }).stdout;
    if (typeof stdout !== "string" || stdout.trim() === "") {
      return {
        authenticated: false,
        reachable: false,
        version,
        detail: "agent status did not answer",
      };
    }
    raw = stdout;
  }

  let payload: StatusPayload;
  try {
    payload = JSON.parse(raw) as StatusPayload;
  } catch {
    return {
      authenticated: false,
      reachable: false,
      version,
      detail: "could not read agent status output",
    };
  }

  if (payload.isAuthenticated !== true) {
    return { authenticated: false, version, detail: "not logged in" };
  }

  const email =
    typeof payload.userInfo?.email === "string" ? payload.userInfo.email : undefined;
  return {
    authenticated: true,
    version,
    detail: email !== undefined ? `signed in · ${email}` : "signed in",
  };
}

/** `agent logout`. Verified idempotent — exits 0 even when never signed in
 * (tested against an isolated, never-authenticated `$HOME`). */
export async function signOut(): Promise<void> {
  try {
    await run(CLI, ["logout"], { timeout: 15_000 });
  } catch {
    // The caller re-reads status regardless — that decides the outcome, not
    // this call's exit code.
  }
}

// ---- the login driver -----------------------------------------------------

function lineReader(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buffer = "";
  return (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      onLine(buffer.slice(0, index).trim());
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  };
}

export function startLogin(
  onUpdate: (update: LoginUpdate) => void,
  options: { killGraceMs?: number } = {},
): LoginHandle {
  const killGraceMs = options.killGraceMs ?? KILL_GRACE_MS;
  const child = spawn(CLI, ["login"], {
    env: { ...process.env, NO_OPEN_BROWSER: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let verificationUrl: string | undefined;
  let settled = false;
  let failure: string | undefined;
  let cancelled = false;

  const notify = (update: LoginUpdate) => {
    try {
      onUpdate(update);
    } catch (error) {
      console.error("overseer: login update listener threw", error);
    }
  };
  const emit = (update: LoginUpdate) => {
    if (settled) return;
    notify(update);
  };

  emit({ phase: "starting" });

  let killTimer: NodeJS.Timeout | undefined;
  const end = (signal: "SIGINT" | "SIGKILL") => {
    child.kill(signal);
    if (signal === "SIGKILL" || killTimer !== undefined) return;
    killTimer = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
    killTimer.unref?.();
  };

  const urlTimer = setTimeout(() => {
    if (verificationUrl !== undefined) return;
    failure = "could not read the CLI's login output — no verification URL appeared";
    end("SIGKILL");
  }, URL_TIMEOUT_MS);

  let idleTimer: NodeJS.Timeout | undefined;
  const armIdle = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      failure = "login timed out waiting for browser authorization";
      end("SIGINT");
    }, IDLE_TIMEOUT_MS);
  };

  child.stdout.on(
    "data",
    lineReader((line) => {
      if (line === "") return;
      const match = URL_LINE.exec(line);
      if (match?.[1] === undefined) return;
      verificationUrl = match[1];
      clearTimeout(urlTimer);
      armIdle();
      // `awaiting-code` is the shared wire phase name — cursor's flow has no
      // code to paste, but the operator still needs the URL, and the UI's
      // code field simply goes unused (submitCode below is a no-op).
      emit({ phase: "awaiting-code", verificationUrl });
    }),
  );

  child.stderr.on(
    "data",
    lineReader((line) => {
      if (line === "") return;
      // No verified vocabulary for cursor's own failure text (capturing it
      // would need a real browser authorization to run the flow to its end)
      // — kept as a possible reason, shown only if the flow does not recover
      // on its own, exactly as claude-code's login.ts treats an unrecognized
      // stderr line.
      failure ??= line;
    }),
  );

  child.on("error", (error) => {
    failure = `could not run ${CLI}: ${error.message}`;
  });

  const ignore = () => {};
  child.stdin.on("error", ignore);
  child.stdout.on("error", ignore);
  child.stderr.on("error", ignore);

  const done = new Promise<AdapterStatus>((resolve) => {
    child.on("close", () => {
      clearTimeout(urlTimer);
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      void (async () => {
        let status: AdapterStatus;
        try {
          status = await readAuthStatus();
        } catch (error) {
          status = {
            authenticated: false,
            reachable: false,
            detail:
              error instanceof Error
                ? `could not re-check auth status · ${error.message}`
                : "could not re-check auth status",
          };
        }
        const update: LoginUpdate = status.authenticated
          ? { phase: "success", status }
          : {
              phase: "failed",
              status,
              detail: cancelled ? "login cancelled" : (failure ?? "login did not complete"),
            };
        settled = true;
        notify(update);
        resolve(status);
      })();
    });
  });

  return {
    /** No-op: this flow has no code to paste back (see the module doc
     * comment) — the operator authorizes entirely in the browser, and the
     * CLI's own polling detects completion. Present only to satisfy the
     * interface. */
    submitCode() {
      // Nothing to do.
    },
    cancel() {
      if (settled) return;
      cancelled = true;
      end("SIGINT");
    },
    done,
  };
}
