import { useEffect } from "react";
import type { OverseerTheme } from "@overseer/protocol";
import type { ProviderInfo } from "../domain";
import type { GitAccessState } from "../state/wizard";
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
  onClose,
  onSelectTheme,
  onOpenCapabilities,
  onOpenGitConfig,
  onStartLogin,
  onSignOut,
  onStopAllSessions,
  stoppableCount,
  onResetOverseer,
}: {
  open: boolean;
  theme: OverseerTheme;
  provider: ProviderInfo;
  /** The container's mounts, which only the server knows; empty until it says. */
  workspace: { root: string };
  /** Undefined until the server answers — which is not the same as "no key". */
  gitAccess?: GitAccessState;
  onClose: () => void;
  onSelectTheme: (theme: OverseerTheme) => void;
  onOpenCapabilities: () => void;
  /** Close settings and open the git config window, where setup happens. */
  onOpenGitConfig: () => void;
  /** Close settings, open the login surface, and start the flow. */
  onStartLogin: () => void;
  /** `claude auth logout` on the container's CLI. Idempotent. */
  onSignOut: () => void;
  /** Interrupt every session with a turn in flight. Sweeps what the client
   * already knows is running — there is no server-side "stop everything". */
  onStopAllSessions: () => void;
  /** How many sessions that sweep would actually reach. Zero disables the
   * button rather than letting it promise an action with no target. */
  stoppableCount: number;
  /** Close settings and put the reset decision up. The panel never wipes
   * anything itself — it only asks. */
  onResetOverseer: () => void;
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
        {gitAccess === undefined ? (
          <div className="w-empty">the server has not reported git access</div>
        ) : (
          <>
            <WInline
              label="ssh key"
              value={
                <span className="w-inline-flex">
                  <StatusLight activity={sshKeyActivity(gitAccess)} />
                  {sshKeyLabel(gitAccess)}
                </span>
              }
            />
            <WInline
              label="identity"
              value={
                gitAccess.identity
                  ? `${gitAccess.identity.name} <${gitAccess.identity.email}>`
                  : "not set"
              }
            />
          </>
        )}
        <div className="btn-row">
          <button className="w-btn" onClick={onOpenGitConfig}>
            configure git
          </button>
        </div>

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
          <WConfirmButton
            label={
              stoppableCount === 0
                ? "stop all sessions"
                : `stop all sessions (${stoppableCount})`
            }
            confirmLabel="stop them all"
            disabled={stoppableCount === 0}
            onConfirm={onStopAllSessions}
          />
          <button className="w-btn danger" onClick={onResetOverseer}>
            reset overseer
          </button>
        </div>
      </div>
    </aside>
  );
}

/** `idle` with no key, `attention` for one ssh would refuse, `done` once set
 * up and usable — the same reading `TestRow` uses for its own connection
 * light, kept consistent here. */
function sshKeyActivity(access: GitAccessState): "idle" | "attention" | "done" {
  if (!access.key) return "idle";
  return access.permissionsOk ? "done" : "attention";
}

function sshKeyLabel(access: GitAccessState): string {
  if (!access.key) return "not set up";
  return access.permissionsOk ? "set up" : "unusable — see git config";
}
