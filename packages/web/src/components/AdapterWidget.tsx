import type { AdapterUsageWindow } from "@overseer/protocol";
import type { AdapterInfo } from "../domain";
import type { Activity } from "../status";
import { StatusLight } from "./StatusLight";

/**
 * Bottom-right, permanent. Runtime facts that are always true and never urgent.
 *
 * A widget is not a window: it follows the theme instead of inverting it, and it
 * is bracketed at the corners rather than framed and tabbed, so it reads as an
 * instrument sitting on the field (design-system.md §6.2). The readout opens
 * the adapter picker; when an adapter is signed in, OPEN CONSOLE sits under it.
 *
 * Usage gauges stay hidden until the adapter has a real reading. A 0% fill
 * that we invented would look like an empty plan; an omitted meter looks like
 * we have not been told yet.
 */
export function AdapterWidget({
  adapter,
  onOpenAdapters,
  onOpenConsole,
}: {
  adapter: AdapterInfo;
  onOpenAdapters: () => void;
  onOpenConsole: () => void;
}) {
  const activity: Activity = adapter.authenticated ? "done" : "waiting";
  // No name means none attached. The instrument still sits on the field — it
  // is permanent furniture — but it reads out nothing, rather than an empty
  // version and a 0% gauge that look like measurements.
  const attached = adapter.name !== "";
  const windows =
    attached && adapter.authenticated && adapter.usage.length > 0
      ? adapter.usage
      : [];

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

            {windows.length > 0 && (
              <span className="widget-usage">
                <span className="widget-kicker">usage</span>
                {windows.map((window) => (
                  <UsageMeter key={window.id} window={window} />
                ))}
              </span>
            )}

            {(adapter.spend || adapter.context) && (
              <span className="widget-row">
                {adapter.spend && (
                  <span className="widget-num">{adapter.spend}</span>
                )}
                {adapter.context && (
                  <span className="widget-num">{adapter.context} ctx</span>
                )}
              </span>
            )}
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
