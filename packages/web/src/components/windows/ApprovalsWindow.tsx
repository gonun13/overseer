import { StatusLight } from "../StatusLight";
import type { Approval } from "../../domain";

export function ApprovalsWindow({
  approvals,
  onResolve,
}: {
  approvals: Approval[];
  onResolve: (id: string) => void;
}) {
  if (approvals.length === 0) {
    return <div className="w-empty">queue empty</div>;
  }

  return (
    <div>
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
