import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
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

/** Optional ink for a row whose *content* carries a meaning the status light
 * cannot — a git file's fate (gone / new / touched), where the row is not a
 * unit of activity at all. Three named tones rather than free colour, so no
 * call site can invent a fourth. */
export type RowTone = "gone" | "new" | "changed";

export function WRow({
  activity,
  primary,
  secondary,
  right,
  actions,
  tone,
  onClick,
  secondaryLines = 1,
}: {
  activity: Activity;
  primary: string;
  secondary?: string;
  right?: string;
  actions?: ReactNode;
  tone?: RowTone;
  onClick?: () => void;
  /**
   * How many lines the secondary may take before it is clipped. One by
   * default: most rows carry a path or a short status, where a second line
   * would be a ragged half-empty one.
   *
   * Two is for rows whose secondary is the point rather than the caption — a
   * skill's description is what a task gets matched against, so an operator
   * deciding whether they already have the right skill is reading exactly that
   * sentence, and one line of it usually ends mid-clause.
   */
  secondaryLines?: 1 | 2;
}) {
  // A row that does something is a control and is reachable like one: the
  // whole row is the target (a button beside the label would compete with the
  // row it sits in), so the role and the keys are put on the row itself. A row
  // that does nothing stays a plain div — an inert row is not a control, and
  // giving it a button's role would only add noise to the tab order.
  const controlProps = onClick
    ? ({
        role: "button",
        tabIndex: 0,
        onClick,
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          // Space would otherwise scroll the window body out from under the
          // thing the operator just activated.
          event.preventDefault();
          onClick();
        },
      } as const)
    : {};

  return (
    <div
      className={`w-row ${onClick ? "clickable" : ""} ${tone ? `tone-${tone}` : ""}`}
      {...controlProps}
    >
      <StatusLight activity={activity} />
      <span className="w-row-main">
        <span className="w-row-primary">{primary}</span>
        {secondary && (
          <span className={`w-row-secondary${secondaryLines === 2 ? " lines-2" : ""}`}>
            {secondary}
          </span>
        )}
      </span>
      {right && <span className="w-row-right">{right}</span>}
      {actions && <span className="w-row-actions">{actions}</span>}
    </div>
  );
}

/**
 * The `w-note` line a window carries when the surface exists but nothing
 * behind it is built yet — the capabilities inventory, the approvals queue,
 * turn context, diff rendering. Same placement and same reasoning as
 * `WProviderNote`: above the content, never instead of it, so the operator can
 * read the shape of the thing and know it is a shape rather than a state.
 *
 * `detail` says *what* is missing in the window's own terms. The "not
 * available yet" half is fixed here so five windows cannot drift into five
 * different ways of admitting the same thing.
 */
export function WUnavailable({ detail }: { detail: string }) {
  return <p className="w-note">not available yet · {detail}</p>;
}

/**
 * A destructive action that asks once, in place.
 *
 * Not a `DecisionWindow`: that surface blocks the whole field and cannot be
 * dismissed, which is right for erasing the overseer's memory and far too
 * heavy for removing one file the operator can write again in a minute. The
 * button becoming its own confirmation keeps the gesture where the thing is.
 *
 * The arming lapses on its own, so a window left open on a half-pressed
 * delete cannot be completed by a later, unrelated click.
 */
export function WConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4_000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      className="w-btn danger"
      disabled={disabled === true}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
