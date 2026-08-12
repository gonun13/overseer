import { StatusLight } from "./StatusLight";
import type { Activity } from "../status";

/**
 * Bottom-right, permanent. Runtime facts that are always true and never urgent.
 *
 * A widget is not a window: it follows the theme instead of inverting it, and it
 * is bracketed at the corners rather than framed and tabbed, so it reads as an
 * instrument sitting on the field (design-system.md §6.2). The readout opens
 * the adapter picker; when an adapter is signed in, OPEN CONSOLE sits under it.
 */
export function AdapterWidget({
  adapter,
  onOpenAdapters,
  onOpenConsole,
}: {
  adapter: {
    name: string;
    version: string;
    authenticated: boolean;
    usage: number;
    spend: string;
    context: string;
  };
  onOpenAdapters: () => void;
  onOpenConsole: () => void;
}) {
  const percent = Math.round(adapter.usage * 100);
  const activity: Activity = adapter.authenticated ? "done" : "waiting";
  // No name means none attached. The instrument still sits on the field — it
  // is permanent furniture — but it reads out nothing, rather than an empty
  // version and a 0% gauge that look like measurements.
  const attached = adapter.name !== "";
  const gaugeColor =
    adapter.usage >= 0.95
      ? "var(--accent)"
      : adapter.usage >= 0.8
        ? "var(--warn)"
        : "var(--text)";

  return (
    <div className="widget settles-in">
      <button
        type="button"
        className="widget-frame"
        onClick={onOpenAdapters}
        aria-label="choose adapter"
      >
        <span className="widget-head">
          <span className="widget-kicker">adapter</span>
          <StatusLight activity={activity} />
        </span>

        {!attached ? (
          <span className="widget-row">
            <span className="widget-dim">none attached</span>
          </span>
        ) : (
          <>
            <span className="widget-row">
              <span className="widget-name">{adapter.name}</span>
              {adapter.version && (
                <span className="widget-dim">v{adapter.version}</span>
              )}
            </span>
            <span className="widget-row">
              <span className="widget-dim">
                {adapter.authenticated ? "signed in" : "not signed in"}
              </span>
            </span>

            <span className="widget-kicker spaced">usage</span>
            <span className="gauge">
              <span
                className="gauge-fill"
                style={{ width: `${percent}%`, background: gaugeColor }}
              />
            </span>
            <span className="widget-row">
              <span className="widget-dim">{percent}% of window</span>
              {adapter.spend && (
                <span className="widget-num">{adapter.spend}</span>
              )}
              {adapter.context && (
                <span className="widget-num">{adapter.context} ctx</span>
              )}
            </span>
          </>
        )}
      </button>

      {adapter.authenticated && (
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
