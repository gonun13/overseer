import { useEffect, useState } from "react";
import { StatusDot } from "./primitives/StatusDot";
import { Gauge } from "./primitives/Gauge";

export function TopBar({ pendingApprovals, theme, onToggleTheme }: {
  pendingApprovals: number;
  theme: "machine" | "samaritan";
  onToggleTheme: () => void;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const clock = now.toLocaleTimeString("en-GB", { hour12: false });

  return (
    <div className="flex h-12 shrink-0 items-center gap-6 border-b border-border bg-panel px-4">
      <div className="flex items-center gap-2">
        <StatusDot status="live" />
        <span className="text-[13px] font-bold tracking-[1.5px]">OVERSEER</span>
      </div>

      <Gauge label="Plan" pct={78} readout="78%" />
      <span className="tabular-nums text-[12px] text-text-dim">$4.12</span>
      <span className="text-[12px] text-text-dim">3 SESSIONS</span>

      <div className="ml-auto flex items-center gap-6">
        <button
          onClick={onToggleTheme}
          className="text-[11px] uppercase tracking-[1px] text-text-faint hover:text-text-dim"
        >
          {theme}
        </button>
        {pendingApprovals > 0 && (
          <span className="text-[12px] font-bold uppercase tracking-[0.5px] text-warn">
            {pendingApprovals} PENDING
          </span>
        )}
        <span className="tabular-nums text-[13px] font-semibold text-text">{clock}</span>
      </div>
    </div>
  );
}
