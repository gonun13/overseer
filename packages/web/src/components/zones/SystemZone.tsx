import { ZoneHeader } from "../primitives/ZoneHeader";
import { StatusDot } from "../primitives/StatusDot";

const ROWS = [
  { label: "Auth", value: "Not logged in", status: "idle" as const },
  { label: "Adapter", value: "claude-code", status: "live" as const },
  { label: "CLI version", value: "—", status: "idle" as const },
  { label: "Theme", value: "machine", status: "idle" as const },
  { label: "Config import / export", value: "/work/_overseer/import", status: "idle" as const },
];

export function SystemZone() {
  return (
    <div className="h-full overflow-y-auto px-10 py-8">
      <ZoneHeader title="System" subtitle="Auth, usage history, settings sources, config" />
      <div className="mt-4 max-w-[640px]">
        {ROWS.map((row) => (
          <div key={row.label} className="flex items-center gap-3 border-b border-border py-3">
            <StatusDot status={row.status} />
            <span className="w-[220px] shrink-0 text-[12px] uppercase tracking-[1px] text-text-faint">
              {row.label}
            </span>
            <span className="text-[13px] text-text">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
