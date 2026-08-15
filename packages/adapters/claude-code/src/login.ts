import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AdapterStatus,
  LoginHandle,
  LoginUpdate,
} from "@overseer/protocol";
import { ensureInteractiveReady } from "./interactive-ready.js";
import { withPendingUsage } from "./usage.js";

/**
 * Every point of contact with the `claude` CLI's *undocumented* surface lives
 * in this package (`login.ts`, `usage.ts`), and nowhere else.
 *
 * The prompt strings below are scraped from a pinned build (2.1.226, see the
 * Dockerfile) and are not part of any contract Anthropic publishes. A version
 * bump can change them. Keeping them together means a bump has one place to
 * fix; the flow fails loudly with "could not read the CLI's login output"
 * rather than hanging silently when it cannot find what it expects.
 *
 * Log hygiene: the verification URL carries a PKCE challenge and the pasted
 * code is a live grant. Neither is ever written to a log, an action-register
 * entry or an error message from this module.
 *
 * No PTY. `claude auth login` is pipe-friendly, and its piped output is
 * *cleaner* than its PTY output (which wraps the URL in an OSC-8 hyperlink) —
 * so plain `child_process.spawn` is both sufficient and better.
 */

// ---- the CLI's surface, in one place --------------------------------------

/** Prints once the URL is ready, on stdout, one line, no ANSI. */
const URL_LINE = /^If the browser didn't open, visit:\s*(\S+)$/;

/**
 * The container has no `xdg-open` and no DISPLAY, so this attempt cannot
 * succeed and there is no flag or env var that suppresses it (verified:
 * BROWSER=/bin/echo, /bin/true and a nonexistent binary are all byte-identical).
 * Dropped rather than rendered — it describes something that never happens.
 */
const BROWSER_LINE = /^Opening browser to sign in/;

/**
 * The CLI checks the *shape* of a pasted code locally, before any network
 * call. It stays alive and re-prompts, so this is a retry, not an end.
 */
const BAD_SHAPE_LINE = /^Invalid code\./;

/** A shape-valid code the exchange refused. Unlike the above, the process dies. */
const LOGIN_FAILED_LINE = /^Login failed:\s*(.*)$/;

/** OSC-8 hyperlink wrapper. Not emitted on this path today; stripped anyway so
 * a future build that adds one does not break the URL match. */
const OSC8 = /\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

const CLI = "claude";

const run = promisify(execFile);

// ---- timeouts -------------------------------------------------------------

/** No URL by now means the output shape changed, not that the network is slow:
 * the URL lands ~300-400ms after spawn. */
const URL_TIMEOUT_MS = 30_000;

/** A login left sitting at the prompt holds the single-flight slot forever. */
const IDLE_TIMEOUT_MS = 10 * 60_000;

/**
 * How long a signalled child gets to exit on its own before it is killed
 * outright.
 *
 * SIGINT is a *request*, and this child installs its own handler for it at the
 * prompt — so a build that changes what that handler does, or one wedged in the
 * middle of a network call, may never act on it. Nothing downstream can
 * recover from that on its own: `done` only settles from `close`, and the
 * server's single-flight slot only frees when `done` settles, so one child that
 * ignores a SIGINT disables login for the life of the process without
 * surfacing an error anywhere. Every signal this module sends is therefore
 * followed by a SIGKILL it cannot decline.
 */
const KILL_GRACE_MS = 5_000;

// ---- auth status ----------------------------------------------------------

/** What `claude auth status --json` answers with. Extra fields are ignored. */
interface AuthStatusPayload {
  loggedIn?: unknown;
  authMethod?: unknown;
  apiProvider?: unknown;
}

/**
 * The real answer to "is this CLI signed in", asked of the CLI itself.
 *
 * Deliberately not a `.credentials.json` presence test: that could not tell a
 * live token from an expired one, and said so in its own `detail`.
 *
 * The exit code is *not* the signal — `auth status` exits 1 when logged out,
 * which is a successful check with a negative answer. The JSON on stdout is the
 * answer, and it is printed on both paths. Never throws.
 */
export async function readAuthStatus(): Promise<AdapterStatus> {
  let version: string | undefined;
  try {
    const { stdout } = await run(CLI, ["--version"], { timeout: 5_000 });
    // "2.1.226 (Claude Code)" — take the version, drop the parenthetical.
    version = stdout.trim().split(/\s+/)[0];
  } catch {
    return {
      authenticated: false,
      reachable: false,
      detail: "claude CLI not found on PATH",
    };
  }

  // `--json` is the current default; passed explicitly so a future default flip
  // to human-readable text cannot silently turn this into a parse failure.
  let raw: string;
  try {
    const { stdout } = await run(CLI, ["auth", "status", "--json"], {
      timeout: 10_000,
    });
    raw = stdout;
  } catch (error) {
    // execFile rejects on a non-zero exit, which is what "logged out" looks
    // like. The payload is still on stdout — read it before giving up.
    const stdout = (error as { stdout?: unknown }).stdout;
    if (typeof stdout !== "string" || stdout.trim() === "") {
      return {
        authenticated: false,
        reachable: false,
        version,
        detail: "claude auth status did not answer",
      };
    }
    raw = stdout;
  }

  let payload: AuthStatusPayload;
  try {
    payload = JSON.parse(raw) as AuthStatusPayload;
  } catch {
    return {
      authenticated: false,
      reachable: false,
      version,
      detail: "could not read claude auth status output",
    };
  }

  if (payload.loggedIn !== true) {
    return { authenticated: false, version, detail: "not logged in" };
  }

  const method =
    typeof payload.authMethod === "string" && payload.authMethod !== "none"
      ? payload.authMethod
      : undefined;
  return {
    authenticated: true,
    version,
    detail: method ? `signed in · ${method}` : "signed in",
  };
}

/** `claude auth logout`. Exits 0 even when never signed in, so this resolves
 * either way — a sign-out that had nothing to do is not a failure. */
export async function signOut(): Promise<void> {
  try {
    await run(CLI, ["auth", "logout"], { timeout: 15_000 });
  } catch {
    // Idempotent by design. The caller re-reads the status regardless, and
    // that — not this call — is what decides whether the operator is out.
  }
}

// ---- the login driver -----------------------------------------------------

/**
 * Splits a stream into lines, holding an unterminated tail. The CLI writes the
 * URL line and its `Paste code here if prompted > ` prompt in one chunk with no
 * newline after the prompt, so a naive per-chunk scan would miss the line the
 * moment the two get coalesced differently.
 */
function lineReader(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buffer = "";
  return (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      onLine(buffer.slice(0, index).replace(OSC8, "").trim());
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  };
}

/**
 * Drives one `claude auth login` to a verdict.
 *
 * The shape of the flow, verified against 2.1.226 in the container:
 *
 * - URL on stdout ~300-400ms after spawn.
 * - A *malformed* paste writes `Invalid code.` to stderr and the process keeps
 *   waiting — the URL already on screen stays valid and a second paste works.
 * - A well-formed but wrong/expired paste writes `Login failed: …` and the
 *   process **exits 1**. That one is not retryable.
 * - SIGINT at the prompt exits **0**, exactly like success. So the exit code is
 *   never the verdict: `readAuthStatus()` is re-run after the child ends and
 *   that answer is the one reported.
 *
 * Only the default `--claudeai` (subscription) flow. `--console` and `--sso`
 * are a product decision that has not been made.
 */
export function startLogin(
  onUpdate: (update: LoginUpdate) => void,
  /**
   * Only the kill grace is adjustable, and only so a test can prove the
   * escalation happens without sitting out the real five seconds. `AdapterLogin`
   * declares `start(onUpdate)`, which this still satisfies — no caller in the
   * server passes it.
   */
  options: { killGraceMs?: number } = {},
): LoginHandle {
  const killGraceMs = options.killGraceMs ?? KILL_GRACE_MS;
  const child = spawn(CLI, ["auth", "login"], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let verificationUrl: string | undefined;
  let settled = false;
  /** The CLI's own words for whatever went wrong last, if anything. */
  let failure: string | undefined;
  let cancelled = false;

  /**
   * A caller's `onUpdate` throwing must not strand the flow. It is the server's
   * publish → broadcast → `ws.send`, which can fail for reasons that have
   * nothing to do with this login; letting that escape would abandon the child
   * and wedge the single-flight slot behind a promise that never settles.
   */
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

  /** SIGINT, then SIGKILL if it was ignored. See `KILL_GRACE_MS`. */
  let killTimer: NodeJS.Timeout | undefined;
  const end = (signal: "SIGINT" | "SIGKILL") => {
    child.kill(signal);
    if (signal === "SIGKILL" || killTimer !== undefined) return;
    killTimer = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
    // A grace timer is not a reason to hold the event loop open.
    killTimer.unref?.();
  };

  const urlTimer = setTimeout(() => {
    if (verificationUrl !== undefined) return;
    failure =
      "could not read the CLI's login output — no verification URL appeared";
    end("SIGKILL");
  }, URL_TIMEOUT_MS);

  let idleTimer: NodeJS.Timeout | undefined;
  const armIdle = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      failure = "login timed out waiting for a code";
      end("SIGINT");
    }, IDLE_TIMEOUT_MS);
  };

  child.stdout.on(
    "data",
    lineReader((line) => {
      if (line === "" || BROWSER_LINE.test(line)) return;
      const match = URL_LINE.exec(line);
      if (match?.[1] === undefined) return;
      verificationUrl = match[1];
      clearTimeout(urlTimer);
      armIdle();
      emit({ phase: "awaiting-code", verificationUrl });
    }),
  );

  child.stderr.on(
    "data",
    lineReader((line) => {
      if (line === "") return;
      if (BAD_SHAPE_LINE.test(line)) {
        // Still alive and still at the prompt: back to awaiting-code with the
        // CLI's reason attached, rather than a dead end the operator has to
        // restart out of (which would invalidate the URL on their screen).
        armIdle();
        emit({
          phase: "awaiting-code",
          verificationUrl,
          detail: line,
          retryable: true,
        });
        return;
      }
      const failed = LOGIN_FAILED_LINE.exec(line);
      if (failed) {
        failure = line;
        return;
      }
      // Anything else the CLI says on stderr is kept as a possible reason but
      // not shown on its own — it may be a warning the flow survives.
      failure ??= line;
    }),
  );

  child.on("error", (error) => {
    failure = `could not run ${CLI}: ${error.message}`;
  });

  // A pipe can break under a write that is already in flight — most easily
  // right after a kill. Unhandled, that surfaces as an EPIPE on the stream and
  // takes the whole server down with it. The stream's death is already covered
  // by `close`; there is nothing to do here but refuse to make it fatal.
  const ignore = () => {};
  child.stdin.on("error", ignore);
  child.stdout.on("error", ignore);
  child.stderr.on("error", ignore);

  const done = new Promise<AdapterStatus>((resolve) => {
    child.on("close", () => {
      clearTimeout(urlTimer);
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      // The verdict. Cancel and success are both exit 0, and a login can also
      // die after having printed a URL — so the only trustworthy answer is to
      // ask the CLI again.
      //
      // This must settle no matter what `readAuthStatus` or the listener does:
      // the server frees its single-flight slot on `done`, so an unsettled
      // promise here is a login button that silently stops working until the
      // process restarts.
      void (async () => {
        let status: AdapterStatus;
        try {
          // Auth only — `/usage` can hang when Anthropic's usage endpoint is
          // down, and must not delay the success frame or the login slot.
          status = withPendingUsage(await readAuthStatus());
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
              detail: cancelled
                ? "login cancelled"
                : (failure ?? "login did not complete"),
            };
        // Pipe-based login writes credentials but does not flip the interactive
        // TUI's onboarding flag — without this, OPEN CONSOLE re-prompts for a
        // browser login. Best-effort: a write failure must not fail the login.
        if (status.authenticated) {
          try {
            await ensureInteractiveReady();
          } catch (error) {
            console.error(
              "adapter-claude-code: could not mark interactive onboarding complete",
              error,
            );
          }
        }
        // `settled` before the notify, so a listener that re-enters cannot be
        // handed a second terminal frame; `notify` swallows its own throw.
        settled = true;
        notify(update);
        resolve(status);
      })();
    });
  });

  return {
    submitCode(code: string) {
      if (settled || child.stdin.destroyed) return;
      // Verbatim apart from surrounding whitespace. The value is
      // `<code>#<state>`: not a URL, so the `#` is not a fragment to discard,
      // and stripping it is a login that fails while telling the operator they
      // copied badly.
      const value = code.trim();
      armIdle();
      emit({ phase: "verifying", verificationUrl });
      child.stdin.write(`${value}\n`);
    },
    cancel() {
      if (settled) return;
      cancelled = true;
      // SIGINT is what the CLI handles at its prompt. It exits 0 doing so,
      // which is why `done` re-checks rather than reading the status — and it
      // is a handler, so `end` escalates to SIGKILL if it is not honoured.
      end("SIGINT");
    },
    done,
  };
}
