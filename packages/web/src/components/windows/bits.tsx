import type { ReactNode } from "react";
import { StatusLight } from "../StatusLight";
import { ACTIVITY_STEP_WORD, type Activity } from "../../status";
import type { ProviderInfo } from "../../domain";

/** Content primitives shared by windows and the settings panel. Nothing here
 * sets a width — the frame owns the width so content can never overflow it. */

export function WTitle({ children }: { children: ReactNode }) {
  return <div className="w-title">{children}</div>;
}

/**
 * The `w-note` line every window carries when its controls need a provider and
 * none is attached. Renders nothing once one is.
 *
 * Above the content rather than instead of it: the window still shows what it
 * would do, so the operator can read the shape of the thing before deciding
 * whether attaching a provider is worth it. Hiding the body would answer a
 * question they have not asked yet. One place, so six windows cannot drift into
 * six different phrasings of the same fact.
 */
export function WProviderNote({ provider }: { provider: ProviderInfo }) {
  if (provider.authenticated) return null;
  return (
    <p className="w-note">
      needs a connected provider · nothing here can act until one is attached.
    </p>
  );
}

export function WInline({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="w-inline">
      <span className="w-inline-label">{label}</span>
      <span className="w-inline-value">{value}</span>
    </div>
  );
}

/**
 * One telegraphic step: `label...        [STATUS]`. A `WRow` would centre a
 * primary and a secondary and put the value on the right — this is a log line,
 * where the label and its bracket read as one string and the dots between them
 * are what makes a run of them scannable.
 *
 * The bracket word comes from `ACTIVITY_STEP_WORD`, so a step has no colour or
 * icon of its own: it is the same light and the same five values as everything
 * else (design-system.md §3).
 */
export function WStep({
  label,
  activity,
  detail,
}: {
  label: string;
  activity: Activity;
  detail?: string;
}) {
  return (
    <div className="w-step">
      <span className="w-step-line">
        <StatusLight activity={activity} />
        <span className="w-step-label">{label}</span>
        <span className="w-step-dots" aria-hidden="true" />
        <span className="w-step-status">[{ACTIVITY_STEP_WORD[activity]}]</span>
      </span>
      {detail && <span className="w-step-detail">{detail}</span>}
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
