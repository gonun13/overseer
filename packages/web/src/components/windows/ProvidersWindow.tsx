import { useState } from "react";
import type { DiscoveredProvider } from "@overseer/protocol";
import type { LoopConfigState } from "../../state/useLoopConfig";
import type { AuthFlow } from "../../state/wizard";
import { providerAuthActivity, providerAuthLabel } from "../usageDisplay";
import { WRow, WTitle } from "./bits";

/**
 * Two views in one window: which registered provider the app itself is
 * attached to (and signing it in), and — a sibling view, switched with the
 * tab strip — which provider the dev loop runs on. The two are independent
 * (loop/bin/lib/providers.sh's `resolve_provider_id` never reads the app's
 * attached provider), so this is not the picker/login split below it: that
 * split is *within* the providers tab and stays exactly as it was.
 */
export function ProvidersWindow({
  providers,
  attachedId,
  auth,
  onConnect,
  onStartLogin,
  onSubmitCode,
  onCancelLogin,
  onSignOut,
  loopConfig,
  onSetLoopProvider,
  onOpenLoopModels,
}: {
  providers: DiscoveredProvider[];
  attachedId?: string;
  auth?: AuthFlow;
  onConnect: (id: string) => void;
  onStartLogin: (id: string) => void;
  onSubmitCode: (code: string) => void;
  onCancelLogin: () => void;
  onSignOut: (id: string) => void;
  loopConfig: LoopConfigState;
  onSetLoopProvider: (id: string) => void;
  onOpenLoopModels: (providerId: string) => void;
}) {
  const [tab, setTab] = useState<"providers" | "loop">("providers");

  if (providers.length === 0) {
    return <div className="w-empty">no providers registered</div>;
  }

  return (
    <div>
      <div className="w-tabs">
        <button
          type="button"
          className={`w-tab ${tab === "providers" ? "active" : ""}`}
          onClick={() => setTab("providers")}
        >
          providers
        </button>
        <button
          type="button"
          className={`w-tab ${tab === "loop" ? "active" : ""}`}
          onClick={() => setTab("loop")}
        >
          loop
        </button>
      </div>
      {tab === "providers" ? (
        <ProvidersTab
          providers={providers}
          attachedId={attachedId}
          auth={auth}
          onConnect={onConnect}
          onStartLogin={onStartLogin}
          onSubmitCode={onSubmitCode}
          onCancelLogin={onCancelLogin}
          onSignOut={onSignOut}
        />
      ) : (
        <LoopTab
          loopConfig={loopConfig}
          onSetProvider={onSetLoopProvider}
          onOpenModels={onOpenLoopModels}
        />
      )}
    </div>
  );
}

/**
 * Pick which registered provider is attached, then sign it in.
 *
 * The two are the same focus zone — "which agent runs my work" — and
 * splitting them would put the operator through two summonings for one
 * decision (design-system.md §6). The authenticate step takes over
 * automatically when the attached provider can log in and has not, which is
 * exactly when there is nothing else in this view worth looking at.
 */
function ProvidersTab({
  providers,
  attachedId,
  auth,
  onConnect,
  onStartLogin,
  onSubmitCode,
  onCancelLogin,
  onSignOut,
}: {
  providers: DiscoveredProvider[];
  attachedId?: string;
  auth?: AuthFlow;
  onConnect: (id: string) => void;
  onStartLogin: (id: string) => void;
  onSubmitCode: (code: string) => void;
  onCancelLogin: () => void;
  onSignOut: (id: string) => void;
}) {
  const [selected, setSelected] = useState(attachedId ?? providers[0]?.id ?? "");

  const attached = providers.find((provider) => provider.id === attachedId);
  const flowing =
    auth !== undefined &&
    auth.providerId === attachedId &&
    auth.phase !== "idle" &&
    auth.phase !== "success";

  // The login surface owns the view whenever there is something to do here:
  // an attached provider that can log in and is not signed in, or a flow
  // already running. Catalog stubs (login: false) stay on the picker.
  if (
    attached !== undefined &&
    attached.login &&
    (flowing || !attached.status.authenticated)
  ) {
    return (
      <LoginStep
        provider={attached}
        auth={auth?.providerId === attached.id ? auth : undefined}
        onStartLogin={() => onStartLogin(attached.id)}
        onSubmitCode={onSubmitCode}
        onCancelLogin={onCancelLogin}
      />
    );
  }

  const canConnect = selected !== "" && selected !== attachedId;

  return (
    <div>
      <WTitle>available providers</WTitle>
      {providers.map((provider) => {
        const active = provider.id === selected;
        const isAttached = provider.id === attachedId;
        return (
          <WRow
            key={provider.id}
            activity={providerAuthActivity(provider.status)}
            primary={provider.id}
            secondary={
              providerAuthLabel(provider.status) +
              (isAttached ? " · attached" : "")
            }
            right={active ? "▪" : undefined}
            onClick={() => setSelected(provider.id)}
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

/**
 * Which provider the dev loop runs on, and a way into each one's step model
 * allocation. No connect/sign-in here — the loop reuses whatever CLI session
 * each provider bundle already has (loop/README.md §"providers"), it does
 * not attach or authenticate its own.
 */
function LoopTab({
  loopConfig,
  onSetProvider,
  onOpenModels,
}: {
  loopConfig: LoopConfigState;
  onSetProvider: (id: string) => void;
  onOpenModels: (providerId: string) => void;
}) {
  if (loopConfig.providers.length === 0) {
    return <div className="w-empty">no providers the loop can run</div>;
  }

  return (
    <div>
      <WTitle>loop provider</WTitle>
      <p className="w-note">
        the dev loop picks its own provider, independent of the one attached
        above — connect and sign-in happen there, not here.
      </p>
      {loopConfig.providers.map((provider) => (
        <WRow
          key={provider.id}
          activity={provider.id === loopConfig.current ? "done" : "idle"}
          primary={provider.id}
          secondary={
            provider.subagentsVerified
              ? undefined
              : "runs every step itself — delegation not yet confirmed"
          }
          right={provider.id === loopConfig.current ? "▪" : undefined}
          onClick={() => onSetProvider(provider.id)}
          actions={
            <button
              type="button"
              className="w-btn"
              onClick={(event) => {
                event.stopPropagation();
                onOpenModels(provider.id);
              }}
            >
              models
            </button>
          }
        />
      ))}
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
  provider,
  auth,
  onStartLogin,
  onSubmitCode,
  onCancelLogin,
}: {
  provider: DiscoveredProvider;
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
      <WTitle>sign in · {provider.id}</WTitle>
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
            opens a verification link in your browser, on your machine. the
            container never opens anything — you copy the code back into the
            field below.
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
                the site shows you, exactly as given.
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
