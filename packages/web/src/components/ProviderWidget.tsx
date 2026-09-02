import type { AdapterUsageWindow } from "@overseer/protocol";
import type { ProviderInfo } from "../domain";
import {
  useUsageCheckElapsed,
  useUsageRetrieveCountdown,
} from "../state/useUsageRetrieveCountdown";
import type { UsageCheckState } from "../state/useUsageCheck";
import {
  providerAuthActivity,
  providerAuthLabel,
  providerUsageDisplay,
  usageCheckLabel,
  usageRetrieveLabel,
  USAGE_UNREADABLE_LABEL,
} from "./usageDisplay";
import { StatusLight } from "./StatusLight";

/**
 * Bottom-right, permanent. Runtime facts that are always true and never urgent.
 *
 * A widget is not a window: it follows the theme instead of inverting it, and it
 * is bracketed at the corners rather than framed and tabbed, so it reads as an
 * instrument sitting on the field (design-system.md §6.2). The readout opens
 * the provider picker; when a provider is signed in, OPEN CONSOLE sits under it.
 *
 * Usage gauges stay hidden until the provider has a real reading, from either
 * of two paths that never both apply to one provider:
 *
 * - automatic (`refreshUsage`, claude-code) — the widget counts down while a
 *   refresh is in flight and says so after a miss, because something is
 *   genuinely happening on its own;
 * - on demand (`checkUsage`, cursor) — nothing happens until the operator
 *   presses CHECK USAGE, so there is no "retrieving…" to show and no miss to
 *   report; the button is the whole story until a reading comes back.
 *
 * The light is auth + reachability: green signed in, red when the CLI is down,
 * amber when it answered but is not signed in.
 */
export function ProviderWidget({
  provider,
  usageCheck,
  onOpenProviders,
  onOpenConsole,
}: {
  provider: ProviderInfo;
  usageCheck: UsageCheckState;
  onOpenProviders: () => void;
  onOpenConsole: () => void;
}) {
  const activity = providerAuthActivity(provider);
  const attached = provider.name !== "";
  const { state: usageState, windows: reported } =
    providerUsageDisplay(provider);
  const { secondsLeft, timedOut } = useUsageRetrieveCountdown(
    usageState === "pending",
  );
  const elapsed = useUsageCheckElapsed(usageCheck.checking);

  // On-demand providers own the usage block outright: their status carries no
  // automatic reading to wait on or to mourn, so the countdown and the "not
  // available" line would both be describing a path that does not exist here.
  const manual = provider.usageCheck && provider.authenticated;
  const showPending = !manual && usageState === "pending" && !timedOut;
  const showUnavailable =
    !manual && (usageState === "unavailable" || timedOut);

  const windows = manual ? usageCheck.windows : reported;
  const spend = usageCheck.spend ?? provider.spend;
  // A check came back that no gauge could be read out of — say so rather than
  // leaving a blank where the numbers should be.
  const unreadable =
    manual &&
    !usageCheck.checking &&
    usageCheck.checked &&
    usageCheck.windows.length === 0;

  return (
    <div className="widget settles-in">
      <button
        type="button"
        className="widget-frame"
        onClick={onOpenProviders}
        aria-label="choose provider"
      >
        <span className="widget-head">
          <span className="widget-kicker">provider</span>
          <StatusLight activity={activity} />
        </span>

        {!attached ? (
          <span className="widget-row">
            <span className="widget-dim">none attached</span>
          </span>
        ) : (
          <>
            <span className="widget-row">
              <span className="widget-name">{provider.name}</span>
              {provider.version && (
                <span className="widget-dim">v{provider.version}</span>
              )}
            </span>
            <span className="widget-row">
              <span className="widget-dim">{providerAuthLabel(provider)}</span>
            </span>

            {windows.length > 0 && (
              <span className="widget-usage">
                <span className="widget-kicker">usage</span>
                {windows.map((window, index) => (
                  <UsageMeter
                    key={window.id}
                    window={window}
                    // Claude's windows each reset on their own clock and each
                    // say so; cursor's pools all turn over with one billing
                    // cycle, and three copies of the same date is noise.
                    showResets={window.resets !== windows[index - 1]?.resets}
                  />
                ))}
              </span>
            )}

            {showPending && (
              <span className="widget-row">
                <span className="widget-dim">
                  {usageRetrieveLabel(secondsLeft)}
                </span>
              </span>
            )}

            {showUnavailable && (
              <span className="widget-row">
                <span className="widget-dim">
                  usage currently not available
                </span>
              </span>
            )}

            {usageCheck.checking && (
              <span className="widget-row">
                <span className="widget-dim">{usageCheckLabel(elapsed)}</span>
              </span>
            )}

            {unreadable && (
              <span className="widget-row">
                <span className="widget-dim">{USAGE_UNREADABLE_LABEL}</span>
              </span>
            )}

            {manual && !usageCheck.checking && usageCheck.error && (
              <span className="widget-row">
                <span className="widget-dim">{usageCheck.error}</span>
              </span>
            )}

            {(spend || provider.context) && (
              <span className="widget-row">
                {spend && <span className="widget-num">{spend}</span>}
                {provider.context && (
                  <span className="widget-num">{provider.context} ctx</span>
                )}
              </span>
            )}
          </>
        )}
      </button>

      {manual && (
        <button
          type="button"
          className="widget-action"
          disabled={usageCheck.checking}
          onClick={usageCheck.check}
        >
          {usageCheck.checking ? "reading" : "check"}{" "}
          <span className="widget-action-word">usage</span>
          {!usageCheck.checking && windows.length > 0 ? " again" : ""}
        </button>
      )}

      {provider.authenticated && (
        <button
          type="button"
          className="widget-console"
          onClick={onOpenConsole}
        >
          open <span className="widget-console-word">console</span>
        </button>
      )}
    </div>
  );
}

function UsageMeter({
  window,
  showResets,
}: {
  window: AdapterUsageWindow;
  showResets: boolean;
}) {
  const percent = Math.round(window.used * 100);
  const color =
    window.used >= 0.95
      ? "var(--accent)"
      : window.used >= 0.8
        ? "var(--warn)"
        : "var(--text)";

  return (
    <span className="widget-meter">
      <span className="widget-row">
        <span className="widget-dim">{window.label}</span>
        <span className="widget-num">{percent}%</span>
      </span>
      <span className="gauge">
        <span
          className="gauge-fill"
          style={{ width: `${percent}%`, background: color }}
        />
      </span>
      {showResets && window.resets && (
        <span className="widget-row">
          <span className="widget-dim">resets {window.resets}</span>
        </span>
      )}
    </span>
  );
}
