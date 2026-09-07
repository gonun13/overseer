import { useEffect, useState } from "react";
import type { OverseerTheme } from "@overseer/protocol";
import type { ProviderInfo } from "../domain";
import type { GitAccessState, GitSshTestState } from "../state/wizard";
import { useUsageRetrieveCountdown } from "../state/useUsageRetrieveCountdown";
import {
  providerAuthActivity,
  providerAuthLabel,
  providerUsageDisplay,
  usageRetrieveLabel,
} from "./usageDisplay";
import { WConfirmButton, WInline, WTitle } from "./windows/bits";
import { CloseIcon } from "./icons";
import { StatusLight } from "./StatusLight";

/**
 * Slides in from the right edge off the gear beside the clock. Settings are not
 * a window: they are not summoned into the field, they are not draggable, and
 * only one can be open — they belong to the machine, not to the work
 * (design-system.md §6).
 */
export function SettingsPanel({
  open,
  theme,
  provider,
  workspace,
  gitAccess,
  gitTest,
  onClose,
  onSelectTheme,
  onOpenCapabilities,
  onStartLogin,
  onSignOut,
  onResetOverseer,
  onGenerateGitKey,
  onRemoveGitKey,
  onTestGitKey,
  onSaveGitIdentity,
}: {
  open: boolean;
  theme: OverseerTheme;
  provider: ProviderInfo;
  /** The container's mounts, which only the server knows; empty until it says. */
  workspace: { root: string };
  /** Undefined until the server answers — which is not the same as "no key". */
  gitAccess?: GitAccessState;
  gitTest?: GitSshTestState;
  onClose: () => void;
  onSelectTheme: (theme: OverseerTheme) => void;
  onOpenCapabilities: () => void;
  /** Close settings, open the login surface, and start the flow. */
  onStartLogin: () => void;
  /** `claude auth logout` on the container's CLI. Idempotent. */
  onSignOut: () => void;
  /** Close settings and put the reset decision up. The panel never wipes
   * anything itself — it only asks. */
  onResetOverseer: () => void;
  onGenerateGitKey: () => void;
  onRemoveGitKey: () => void;
  onTestGitKey: (host: string, port?: number) => void;
  onSaveGitIdentity: (name: string, email: string) => void;
}) {
  // The panel overlays the right-hand widgets, so it must not be left open by accident.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // There are only two themes, so picking the one already active is a no-op —
  // persistence only needs to fire when the choice actually changes.
  function selectTheme(target: OverseerTheme) {
    if (target !== theme) onSelectTheme(target);
  }

  const { state: usageState } = providerUsageDisplay(provider);
  const { secondsLeft, timedOut } = useUsageRetrieveCountdown(
    usageState === "pending",
  );
  const showPending = usageState === "pending" && !timedOut;
  const showUnavailable = usageState === "unavailable" || timedOut;

  return (
    // `inert` rather than `aria-hidden`: the panel is always mounted so it can
    // slide, and its buttons must not be tabbable while it is off-screen.
    <aside className={`panel ${open ? "open" : ""}`} inert={!open}>
      <header className="panel-head">
        <span className="panel-title">
          <span style={{ color: "var(--mark-fill)" }}>▽</span> system
        </span>
        <button
          className="icon-btn"
          onClick={onClose}
          aria-label="close settings"
        >
          <CloseIcon />
        </button>
      </header>

      <div className="panel-body">
        <WTitle>auth</WTitle>
        <WInline
          label="subscription"
          value={
            <span className="w-inline-flex">
              <StatusLight activity={providerAuthActivity(provider)} />
              {providerAuthLabel(provider)}
            </span>
          }
        />
        <div className="btn-row">
          <button
            className="w-btn"
            onClick={provider.authenticated ? onSignOut : onStartLogin}
          >
            {provider.authenticated ? "sign out" : "start login"}
          </button>
        </div>

        <WTitle>runtime</WTitle>
        {provider.name ? (
          <>
            <WInline label="provider" value={provider.name} />
            <WInline label="cli version" value={provider.version} />
            {provider.usage.map((window) => (
              <WInline
                key={window.id}
                label={window.label}
                value={
                  window.resets
                    ? `${Math.round(window.used * 100)}% · resets ${window.resets}`
                    : `${Math.round(window.used * 100)}%`
                }
              />
            ))}
            {showPending && (
              <WInline label="usage" value={usageRetrieveLabel(secondsLeft)} />
            )}
            {showUnavailable && (
              <WInline label="usage" value="currently not available" />
            )}
            {provider.spend ? (
              <WInline label="spend this window" value={provider.spend} />
            ) : null}
          </>
        ) : (
          <div className="w-empty">no provider attached</div>
        )}

        <WTitle>workspace</WTitle>
        {workspace.root ? (
          <WInline label="root" value={workspace.root} />
        ) : (
          <div className="w-empty">the server has not reported its mounts</div>
        )}

        <WTitle>git access</WTitle>
        <GitAccessSection
          access={gitAccess}
          test={gitTest}
          onGenerate={onGenerateGitKey}
          onRemove={onRemoveGitKey}
          onTest={onTestGitKey}
          onSaveIdentity={onSaveGitIdentity}
        />

        <WTitle>capabilities</WTitle>
        <p className="panel-note">
          mcp servers, skills and subagents available to every session.
        </p>
        <div className="btn-row">
          <button className="w-btn" onClick={onOpenCapabilities}>
            open capabilities
          </button>
        </div>

        <WTitle>appearance</WTitle>
        <WInline
          label="theme"
          value={
            // A span, not a div: WInline's value slot is a <span>, and a block
            // element inside it would be invalid nesting.
            <span className="btn-row inline">
              <button
                className="w-btn"
                onClick={() => selectTheme("samaritan")}
              >
                <span className="w-btn-mark">
                  {theme === "samaritan" ? "▪" : ""}
                </span>
                samaritan
              </button>
              <button className="w-btn" onClick={() => selectTheme("machine")}>
                <span className="w-btn-mark">
                  {theme === "machine" ? "▪" : ""}
                </span>
                machine
              </button>
            </span>
          }
        />

        <WTitle>danger</WTitle>
        <div className="btn-row">
          <button className="w-btn danger">stop all sessions</button>
          <button className="w-btn danger" onClick={onResetOverseer}>
            reset overseer
          </button>
        </div>
      </div>
    </aside>
  );
}

/**
 * The container's git access: one ssh key, the identity commits carry, and a
 * way to prove the key works.
 *
 * The key is generated here and never uploaded — only the public half is ever
 * shown, so nothing secret crosses the browser. The test targets are the hosts
 * the workspace's own remotes point at rather than a fixed list of public
 * forges: a self-hosted host on a non-default port is exactly the case a key
 * is most needed for.
 */
function GitAccessSection({
  access,
  test,
  onGenerate,
  onRemove,
  onTest,
  onSaveIdentity,
}: {
  access?: GitAccessState;
  test?: GitSshTestState;
  onGenerate: () => void;
  onRemove: () => void;
  onTest: (host: string, port?: number) => void;
  onSaveIdentity: (name: string, email: string) => void;
}) {
  if (access === undefined) {
    return <div className="w-empty">the server has not reported git access</div>;
  }

  return (
    <>
      {access.key === undefined ? (
        <>
          <p className="panel-note">
            no key yet. generating one makes an ssh keypair inside the
            container; you copy the public half to your git host. the private
            half never leaves.
          </p>
          <div className="btn-row">
            <button className="w-btn" onClick={onGenerate}>
              generate key
            </button>
          </div>
        </>
      ) : (
        <>
          {!access.permissionsOk && (
            <p className="panel-note">
              this key cannot be used — its file permissions are wrong, which
              usually means it was written under a different user id. generate
              a new one.
            </p>
          )}
          <WInline label="fingerprint" value={access.key.fingerprint} />
          <PublicKeyRow publicKey={access.key.publicKey} />
          <TestRow hosts={access.hosts} test={test} onTest={onTest} />
          <div className="btn-row">
            <WConfirmButton
              label="remove key"
              confirmLabel="really remove"
              onConfirm={onRemove}
            />
          </div>
        </>
      )}

      <IdentityRow identity={access.identity} onSave={onSaveIdentity} />
    </>
  );
}

/** The public key, selectable and copyable. Shown in full rather than
 * truncated: the operator's next move is to paste the whole thing somewhere. */
function PublicKeyRow({ publicKey }: { publicKey: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <>
      <p className="panel-note">
        add this to your git host, then test the connection below.
      </p>
      <textarea
        className="w-input w-key"
        readOnly
        rows={3}
        value={publicKey}
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="btn-row">
        <button
          className="w-btn"
          onClick={() => {
            void navigator.clipboard?.writeText(publicKey).then(
              () => setCopied(true),
              () => undefined,
            );
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
    </>
  );
}

function TestRow({
  hosts,
  test,
  onTest,
}: {
  hosts: GitAccessState["hosts"];
  test?: GitSshTestState;
  onTest: (host: string, port?: number) => void;
}) {
  // Nothing in the workspace uses ssh yet, so there is no host worth naming a
  // button after. github is the one guess worth offering.
  const targets = hosts.length > 0 ? hosts : [{ host: "github.com" }];

  return (
    <>
      {test !== undefined && (
        <WInline
          label="connection"
          value={
            <span className="w-inline-flex">
              {/* `attention` rather than a bespoke failure colour — a refused
                  key is something for the operator to act on, which is what
                  that word already means everywhere else. */}
              <StatusLight
                activity={
                  test.status === "working"
                    ? "working"
                    : test.ok
                      ? "done"
                      : "attention"
                }
              />
              {test.status === "working"
                ? `testing ${test.host}…`
                : `${test.host} · ${test.message ?? ""}`}
            </span>
          }
        />
      )}
      {test?.status === "done" && test.hostFingerprint && (
        <WInline label="host key" value={test.hostFingerprint} />
      )}
      <div className="btn-row">
        {targets.map((target) => (
          <button
            key={`${target.host}:${target.port ?? ""}`}
            className="w-btn"
            disabled={test?.status === "working"}
            onClick={() => onTest(target.host, target.port)}
          >
            test {target.host}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * The identity the app's own commits are authored under.
 *
 * Kept here rather than in a git config file because the container is handed
 * `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` from the host — empty when the host has
 * none — and git reads those ahead of any config file, so a config-file
 * identity would simply be ignored.
 */
function IdentityRow({
  identity,
  onSave,
}: {
  identity?: { name: string; email: string };
  onSave: (name: string, email: string) => void;
}) {
  const [name, setName] = useState(identity?.name ?? "");
  const [email, setEmail] = useState(identity?.email ?? "");
  const [saved, setSaved] = useState(false);

  const dirty = name !== (identity?.name ?? "") || email !== (identity?.email ?? "");
  const complete = name.trim().length > 0 && email.includes("@");

  return (
    <>
      <p className="panel-note">
        who commits made from here are authored as.
      </p>
      <WInline
        label="name"
        value={
          <input
            className="w-input"
            value={name}
            placeholder="your name"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
        }
      />
      <WInline
        label="email"
        value={
          <input
            className="w-input"
            value={email}
            placeholder="you@example.com"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => {
              setEmail(e.target.value);
              setSaved(false);
            }}
          />
        }
      />
      <div className="btn-row">
        <button
          className="w-btn"
          disabled={!complete || !dirty}
          onClick={() => {
            onSave(name.trim(), email.trim());
            setSaved(true);
          }}
        >
          {saved && !dirty ? "saved" : "save identity"}
        </button>
      </div>
    </>
  );
}
