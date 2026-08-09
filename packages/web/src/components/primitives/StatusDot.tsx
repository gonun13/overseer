export type Status = "live" | "warn" | "danger" | "idle";

const COLOR: Record<Status, string> = {
  live: "var(--accent)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  idle: "var(--text-faint)",
};

export function StatusDot({ status }: { status: Status }) {
  return (
    <span
      className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${status === "live" ? "status-dot--live" : ""}`}
      style={{ background: COLOR[status] }}
    />
  );
}
