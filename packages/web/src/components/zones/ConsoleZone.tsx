import { useState } from "react";
import { StatusDot } from "../primitives/StatusDot";
import { RosterRow } from "../primitives/RosterRow";
import { DiffView } from "../primitives/DiffView";
import { PromptInput } from "../primitives/PromptInput";
import { Gauge } from "../primitives/Gauge";
import { mockSessions, mockTodos } from "../../data/mock";

export function ConsoleZone() {
  const [activeSession, setActiveSession] = useState(mockSessions[0]!.id);

  return (
    <div className="flex h-full min-w-0">
      {/* session rail */}
      <div className="flex w-[240px] shrink-0 flex-col overflow-y-auto border-r border-border">
        {mockSessions.map((s) => (
          <RosterRow
            key={s.id}
            status={s.status}
            primary={s.name}
            secondary={`${s.model} · ${s.elapsed}`}
            active={s.id === activeSession}
            onClick={() => setActiveSession(s.id)}
          />
        ))}
      </div>

      {/* transcript */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="max-w-[78ch] space-y-5">
            <TranscriptTurn role="user" text="Add rate limiting to the refund endpoint." />
            <TranscriptTurn
              role="agent"
              text="I'll add a token-bucket limiter in the refund handler and wire it through the existing middleware chain."
            />
            <ToolCallBlock name="Edit" target="packages/billing/src/refund.ts" />
            <TranscriptTurn role="agent" text="Tests pass. Limiter caps refunds at 5/min per account." />
          </div>
        </div>
        <PromptInput />
      </div>

      {/* inspector */}
      <div className="flex w-[420px] shrink-0 flex-col overflow-y-auto border-l border-border px-5 py-5">
        <section>
          <h2 className="mb-3 text-[10.5px] uppercase tracking-[1px] text-text-faint">Diff</h2>
          <DiffView
            lines={[
              { kind: "ctx", text: "export async function refund(req: RefundRequest) {" },
              { kind: "add", text: "  await limiter.consume(req.accountId);" },
              { kind: "ctx", text: "  return processRefund(req);" },
              { kind: "ctx", text: "}" },
            ]}
          />
        </section>

        <section className="mt-6">
          <h2 className="mb-3 text-[10.5px] uppercase tracking-[1px] text-text-faint">Todo</h2>
          <ul className="space-y-2">
            {mockTodos.map((t, i) => (
              <li key={i} className="flex items-center gap-2 text-[13px]">
                <StatusDot
                  status={t.status === "completed" ? "idle" : t.status === "in_progress" ? "live" : "idle"}
                />
                <span className={t.status === "completed" ? "text-text-faint line-through" : "text-text"}>
                  {t.content}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="text-[10.5px] uppercase tracking-[1px] text-text-faint">Budget</h2>
          <Gauge label="Context" pct={34} readout="34K / 200K" width="140px" />
          <Gauge label="Cost" pct={62} readout="$1.24 / $2.00" width="140px" />
        </section>
      </div>
    </div>
  );
}

function TranscriptTurn({ role, text }: { role: "user" | "agent"; text: string }) {
  return (
    <div>
      <div className="mb-1 text-[10.5px] uppercase tracking-[1px] text-text-faint">
        {role === "user" ? "You" : "Agent"}
      </div>
      <p className="text-[13.5px] leading-[1.6] text-text">{text}</p>
    </div>
  );
}

function ToolCallBlock({ name, target }: { name: string; target: string }) {
  return (
    <div className="rounded-[3px] border border-border bg-panel px-3 py-2">
      <div className="flex items-center gap-2 text-[12px]">
        <StatusDot status="idle" />
        <span className="font-semibold uppercase tracking-[0.5px] text-text-dim">{name}</span>
        <span className="truncate text-text-faint">{target}</span>
      </div>
    </div>
  );
}
