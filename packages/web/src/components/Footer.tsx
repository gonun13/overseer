import { overseerVersionLabel } from "../appVersion";

/** Foot of the right rail: the version, and the way to help once there is a
 * prompt to ask in. */
export function Footer({
  helpVisible,
  onOpenHelp,
  onOpenChangelog,
}: {
  helpVisible: boolean;
  onOpenHelp: () => void;
  onOpenChangelog: () => void;
}) {
  return (
    <p className="footer settles-in">
      {/* The version is the changelog's own handle: an operator who notices
          the number is the one asking what changed in it. Reads as footer
          type until hovered — `.footer-link` inherits, so this is a word you
          can click, not a control. */}
      <button type="button" className="footer-link" onClick={onOpenChangelog}>
        {overseerVersionLabel()}
      </button>
      {helpVisible && (
        <>
          {" "}
          | ask for{" "}
          <button
            type="button"
            className="footer-link"
            style={{ color: "var(--accent)" }}
            onClick={onOpenHelp}
          >
            help
          </button>
        </>
      )}
    </p>
  );
}
