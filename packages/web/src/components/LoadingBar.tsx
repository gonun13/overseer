import { BOOT_MS } from "../state/wizard";

/**
 * The boot bar. Shown for the whole boot phase — the minimum beat plus any
 * wait for the socket — and nowhere else. This is the wizard's opening, not a
 * spinner (spinners are an anti-pattern here; the headline and its rule are
 * the progress indicator for everything else).
 *
 * It fills once over `BOOT_MS`, then sits full if boot is still waiting on the
 * socket. A looping bar would claim work of unknown length; the minimum beat
 * is known, and past that the headline switches to "connecting". Duration
 * comes from `BOOT_MS` so the animation cannot drift from the minimum beat.
 *
 * Under `prefers-reduced-motion` the fill's animation is dropped in CSS and
 * the bar sits full instead — the state still shows, it just stops moving
 * (design-system.md §9).
 */
export function LoadingBar() {
  return (
    <div
      className="loading-bar"
      role="progressbar"
      aria-label="starting"
      style={{ "--boot-ms": `${BOOT_MS}ms` } as React.CSSProperties}
    >
      <div className="loading-bar-fill" />
    </div>
  );
}
