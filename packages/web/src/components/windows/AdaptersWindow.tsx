import { useState } from "react";
import type { DiscoveredAdapter } from "@overseer/protocol";
import { WRow, WTitle } from "./bits";

/**
 * Pick which registered adapter is attached. Auth is a later step — Connect
 * only records the choice. The widget and adapter signals open this window.
 */
export function AdaptersWindow({
  adapters,
  attachedId,
  onConnect,
}: {
  adapters: DiscoveredAdapter[];
  attachedId?: string;
  onConnect: (id: string) => void;
}) {
  const [selected, setSelected] = useState(
    attachedId ?? adapters[0]?.id ?? "",
  );

  if (adapters.length === 0) {
    return <div className="w-empty">no adapters registered</div>;
  }

  const canConnect = selected !== "" && selected !== attachedId;

  return (
    <div>
      <WTitle>available adapters</WTitle>
      {adapters.map((adapter) => {
        const active = adapter.id === selected;
        const attached = adapter.id === attachedId;
        return (
          <WRow
            key={adapter.id}
            activity={adapter.status.authenticated ? "done" : "waiting"}
            primary={adapter.id}
            secondary={
              (adapter.status.authenticated ? "signed in" : "not signed in") +
              (attached ? " · attached" : "")
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
      </div>
    </div>
  );
}
