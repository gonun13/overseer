import { StatusLight } from "../StatusLight";
import { WProviderNote } from "./bits";
import type { Approval, ProviderInfo } from "../../domain";

export function ApprovalsWindow({
  approvals,
  provider,
  onResolve,
}: {
  approvals: Approval[];
  provider: ProviderInfo;
  onResolve: (id: string) => void;
}) {
  return (
    <div>
      <WProviderNote provider={provider} />
      {approvals.length === 0 && <div className="w-empty">queue empty</div>}
      {approvals.map((a) => (
        <div key={a.id} className="approval">
          <div className="approval-head">
            <StatusLight activity={a.activity} />
            <span className="w-data">{a.ref}</span>
            <span className="approval-tool">{a.tool}</span>
            <span className="approval-session">{a.session}</span>
          </div>
          <div className="w-pre approval-body">{a.body}</div>
          <div className="btn-row">
            <button className="w-btn" onClick={() => onResolve(a.id)}>
              allow once
            </button>
            <button className="w-btn" onClick={() => onResolve(a.id)}>
              allow always
            </button>
            <button className="w-btn danger" onClick={() => onResolve(a.id)}>
              deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
