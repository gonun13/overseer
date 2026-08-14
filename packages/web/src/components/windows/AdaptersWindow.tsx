import { useState } from "react";
import type { DiscoveredAdapter } from "@overseer/protocol";
import type { AuthFlow } from "../../state/wizard";
import { WRow, WTitle } from "./bits";

/**
 * Two steps in one window rather than two windows: pick which registered
 * adapter is attached, then sign it in.
 *
 * They are the same focus zone — "which agent runs my work" — and splitting
 * them would put the operator through two summonings for one decision
 * (design-system.md §6). The authenticate step takes over automatically when
 * the attached adapter can log in and has not, which is exactly when there is
 * nothing else in this window worth looking at.
 */
export function AdaptersWindow({
  adapters,
  attachedId,
  auth,
  onConnect,
  onStartLogin,
  onSubmitCode,
  onCancelLogin,
  onSignOut,
}: {
  adapters: DiscoveredAdapter[];
  attachedId?: string;
  auth?: AuthFlow;
  onConnect: (id: string) => void;
  onStartLogin: (id: string) => void;
  onSubmitCode: (code: string) => void;
  onCancelLogin: () => void;
  onSignOut: (id: string) => void;
}) {
  const [selected, setSelected] = useState(attachedId ?? adapters[0]?.id ?? "");

  if (adapters.length === 0) {
    return <div className="w-empty">no adapters registered</div>;
  }

  const attached = adapters.find((adapter) => adapter.id === attachedId);
  const flowing =
    auth !== undefined &&
    auth.adapterId === attachedId &&
    auth.phase !== "idle" &&
    auth.phase !== "success";

  // The login surface owns the window whenever there is something to do here:
  // an attached adapter that is not signed in, or a flow already running.
  if (attached !== undefined && (flowing || !attached.status.authenticated)) {
    return (
      <LoginStep
        adapter={attached}
        auth={auth?.adapterId === attached.id ? auth : undefined}
        onStartLogin={() => onStartLogin(attached.id)}
        onSubmitCode={onSubmitCode}
        onCancelLogin={onCancelLogin}
      />
    );
  }

  const canConnect = selected !== "" && selected !== attachedId;

  return (
    <div>
      <WTitle>available adapters</WTitle>
      {adapters.map((adapter) => {
        const active = adapter.id === selected;
        const isAttached = adapter.id === attachedId;
        return (
          <WRow
            key={adapter.id}
            activity={adapter.status.authenticated ? "done" : "waiting"}
            primary={adapter.id}
            secondary={
              (adapter.status.authenticated ? "signed in" : "not signed in") +
              (isAttached ? " · attached" : "")
            }
            right={active ? "▪" : undefined}
            onClick={() => setSelected(adapter.id)}
          />
        );
      })}
      <div className="btn-row">
        <button
          type="button"
          className="w-btn"
          disabled={!canConnect}
          onClick={() => {
            if (!canConnect) return;
            onConnect(selected);
          }}
        >
          connect
        </button>
        {attached?.status.authenticated && (
          <button
            type="button"
            className="w-btn"
            onClick={() => onSignOut(attached.id)}
          >
            sign out
          </button>
        )}
      </div>
    </div>
  );
}

/** Operator-facing word for each phase. The server's vocabulary, not a second
 * one — nothing here infers a phase the server did not report. */
const PHASE_WORD: Record<AuthFlow["phase"], string> = {
  idle: "not signed in",
  starting: "starting the cli…",
  "awaiting-code": "waiting for your code",
  verifying: "checking the code…",
  success: "signed in",
  failed: "login failed",
};

/**
 * The login surface.
 *
 * The browser that does the signing in is **the operator's, on the operator's
 * machine**. The container is headless, its own browser-open attempt is a
 * no-op, and there is no callback for anything to redirect to — so the URL on
 * screen (and the code that comes back through the paste field) is the entire
 * channel.
 */
function LoginStep({
  adapter,
  auth,
  onStartLogin,
  onSubmitCode,
  onCancelLogin,
}: {
  adapter: DiscoveredAdapter;
  auth?: AuthFlow;
  onStartLogin: () => void;
  onSubmitCode: (code: string) => void;
  onCancelLogin: () => void;
}) {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);

  const phase = auth?.phase;
  const running =
    phase === "starting" || phase === "awaiting-code" || phase === "verifying";
  const url = auth?.verificationUrl;

  const copy = () => {
    if (url === undefined) return;
    void navigator.clipboard?.writeText(url).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  const submit = () => {
    // Only the whitespace a paste drags in. The value is `<code>#<state>` and
    // every other character of it is the CLI's business — this field must not
    // split on `#`, decode, or lowercase anything.
    const value = code.trim();
    if (value === "") return;
    onSubmitCode(value);
    setCode("");
  };

  return (
    <div>
      <WTitle>sign in · {adapter.id}</WTitle>
      <WRow
        activity={
          phase === "failed"
            ? "attention"
            : phase === "success"
              ? "done"
              : running
                ? "working"
                : "waiting"
        }
        primary={PHASE_WORD[phase ?? "idle"]}
        secondary={auth?.detail}
      />

      {!running && (
        <>
          <p className="w-note">
            opens claude.com in your browser, on your machine. the container
            never opens anything — you copy the code back into the field below.
          </p>
          <div className="btn-row">
            <button type="button" className="w-btn" onClick={onStartLogin}>
              {phase === "failed" ? "try again" : "start login"}
            </button>
          </div>
        </>
      )}

      {running && (
        <>
          {url === undefined ? (
            <p className="w-note">waiting for the cli's verification link…</p>
          ) : (
            <>
              <p className="w-note">
                1 · open this on your machine and authorize. 2 · paste the code
                claude.com shows you, exactly as given.
              </p>
              <div className="btn-row">
                {/* `noopener noreferrer`: this opens on the operator's machine
                    and the console must not be reachable from that tab. */}
                <a
                  className="w-btn"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  open verification link
                </a>
                {/* A remote or kiosk operator may not be sitting at the machine
                    rendering this console — they need the URL itself. */}
                <button type="button" className="w-btn" onClick={copy}>
                  {copied ? "copied" : "copy link"}
                </button>
              </div>
            </>
          )}

          <div className="btn-row">
            <input
              className="w-input"
              type="text"
              value={code}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="paste the code here"
              aria-label="verification code"
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
            />
            <button
              type="button"
              className="w-btn"
              disabled={code.trim() === ""}
              onClick={submit}
            >
              submit
            </button>
            <button type="button" className="w-btn" onClick={onCancelLogin}>
              cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
