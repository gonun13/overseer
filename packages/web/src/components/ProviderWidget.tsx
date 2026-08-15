import type { AdapterUsageWindow } from "@overseer/protocol";
import type { ProviderInfo } from "../domain";
import { useUsageRetrieveCountdown } from "../state/useUsageRetrieveCountdown";
import {
  providerAuthActivity,
  providerAuthLabel,
  providerUsageDisplay,
  usageRetrieveLabel,
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
 * Usage gauges stay hidden until the provider has a real reading. While a
 * refresh is in flight the instrument counts down; after a miss it says usage is
 * unavailable rather than leaving a blank that looks like "not asked yet".
 *
 * The light is auth + reachability: green signed in, red when the CLI is down,
 * amber when it answered but is not signed in.
 */
export function ProviderWidget({
  provider,
  onOpenProviders,
  onOpenConsole,
}: {
  provider: ProviderInfo;
  onOpenProviders: () => void;
  onOpenConsole: () => void;
}) {
  const activity = providerAuthActivity(provider);
  const attached = provider.name !== "";
  const { state: usageState, windows } = providerUsageDisplay(provider);
  const { secondsLeft, timedOut } = useUsageRetrieveCountdown(
    usageState === "pending",
  );
  const showPending = usageState === "pending" && !timedOut;
  const showUnavailable = usageState === "unavailable" || timedOut;

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

            {usageState === "ready" && windows.length > 0 && (
              <span className="widget-usage">
                <span className="widget-kicker">usage</span>
                {windows.map((window) => (
                  <UsageMeter key={window.id} window={window} />
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

            {(provider.spend || provider.context) && (
              <span className="widget-row">
                {provider.spend && (
                  <span className="widget-num">{provider.spend}</span>
                )}
                {provider.context && (
                  <span className="widget-num">{provider.context} ctx</span>
                )}
              </span>
            )}
          </>
        )}
      </button>

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

function UsageMeter({ window }: { window: AdapterUsageWindow }) {
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
      {window.resets && (
        <span className="widget-row">
          <span className="widget-dim">resets {window.resets}</span>
        </span>
      )}
    </span>
  );
}
