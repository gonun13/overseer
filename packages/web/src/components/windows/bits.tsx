import type { ReactNode } from "react";
import { StatusLight } from "../StatusLight";
import type { Activity } from "../../status";

/** Content primitives shared by windows and the settings panel. Nothing here
 * sets a width — the frame owns the width so content can never overflow it. */

export function WTitle({ children }: { children: ReactNode }) {
  return <div className="w-title">{children}</div>;
}

export function WInline({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="w-inline">
      <span className="w-inline-label">{label}</span>
      <span className="w-inline-value">{value}</span>
    </div>
  );
}

export function WRow({
  activity,
  primary,
  secondary,
  right,
  actions,
  onClick,
}: {
  activity: Activity;
  primary: string;
  secondary?: string;
  right?: string;
  actions?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className={`w-row ${onClick ? "clickable" : ""}`} onClick={onClick}>
      <StatusLight activity={activity} />
      <span className="w-row-main">
        <span className="w-row-primary">{primary}</span>
        {secondary && <span className="w-row-secondary">{secondary}</span>}
      </span>
      {right && <span className="w-row-right">{right}</span>}
      {actions && <span className="w-row-actions">{actions}</span>}
    </div>
  );
}
