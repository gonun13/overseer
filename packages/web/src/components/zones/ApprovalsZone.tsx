import { useState } from "react";
import { ZoneHeader } from "../primitives/ZoneHeader";
import { StatusDot } from "../primitives/StatusDot";
import { DiffView } from "../primitives/DiffView";
import { mockApprovals } from "../../data/mock";

export function ApprovalsZone() {
  const [selected, setSelected] = useState(mockApprovals[0]?.id);
  const active = mockApprovals.find((a) => a.id === selected);

  return (
    <div className="flex h-full min-w-0">
      <div className="flex w-[420px] shrink-0 flex-col overflow-y-auto border-r border-border px-6 py-6">
        <ZoneHeader title="Approvals" subtitle="Cross-session intervention queue" />
        <div className="mt-4 space-y-1">
          {mockApprovals.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelected(a.id)}
              className={`flex w-full items-start gap-4 border-b border-border px-2 py-3 text-left ${
                a.id === selected ? "bg-panel-alt" : ""
              }`}
            >
              <div className="w-[130px] shrink-0">
                <div className="text-[22px] font-bold tabular-nums">{a.identifier}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <StatusDot status={a.severity} />
                  <span className="text-[10.5px] uppercase tracking-[1px] text-text-faint">{a.severity}</span>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-text">{a.tool}</div>
                <div className="truncate text-[11.5px] text-text-dim">{a.sessionName}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {active ? (
          <>
            <h2 className="text-[15px] font-bold">{active.tool}</h2>
            <p className="mt-1 text-[12px] text-text-dim">{active.sessionName}</p>
            <div className="mt-4">
              <DiffView lines={[{ kind: "del", text: active.summary }]} />
            </div>
            <div className="mt-6 flex gap-2">
              <ApprovalButton label="Allow once" tone="accent" />
              <ApprovalButton label="Allow always" tone="accent" />
              <ApprovalButton label="Deny" tone="danger" />
              <ApprovalButton label="Deny with feedback" tone="danger" />
            </div>
          </>
        ) : (
          <p className="text-[13px] text-text-faint">No pending approvals.</p>
        )}
      </div>
    </div>
  );
}

function ApprovalButton({ label, tone }: { label: string; tone: "accent" | "danger" }) {
  return (
    <button
      className="border px-3 py-1.5 text-[12px] uppercase tracking-[1px] hover:bg-panel-alt"
      style={{ borderColor: `var(--${tone})`, color: `var(--${tone})` }}
    >
      {label}
    </button>
  );
}
