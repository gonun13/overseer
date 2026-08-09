import { ZONES, type ZoneId } from "../zones";

export function NavRail({ active, onSelect }: { active: ZoneId; onSelect: (z: ZoneId) => void }) {
  return (
    <div className="flex w-[190px] shrink-0 flex-col border-r border-border bg-panel">
      <nav className="flex-1 py-2">
        {ZONES.map((zone) => {
          const isActive = zone.id === active;
          return (
            <button
              key={zone.id}
              onClick={() => onSelect(zone.id)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] uppercase tracking-[1px] ${
                isActive ? "bg-panel-alt font-semibold text-accent" : "text-text-dim hover:text-text"
              }`}
            >
              <span className="text-[10.5px] text-text-faint">{zone.num}</span>
              {zone.label}
            </button>
          );
        })}
      </nav>
      <div className="border-t border-border px-4 py-3 text-[10.5px] leading-[1.6] text-text-faint">
        <div>ADAPTER: CLAUDE-CODE</div>
        <div>CLI: —</div>
        <div>UPTIME: 00:00:00</div>
      </div>
    </div>
  );
}
