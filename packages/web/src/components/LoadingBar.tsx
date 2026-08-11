import { BOOT_MS } from "../state/wizard";

/**
 * The boot bar. Shown during the boot beat and nowhere else — this is the
 * wizard's opening, not a spinner (spinners are an anti-pattern here; the
 * headline and its rule are the progress indicator for everything else).
 *
 * It fills once, over exactly the length of the beat, rather than looping.
 * A looping bar claims work is ongoing and that its end is not yet known;
 * neither is true here — the beat has a fixed length and nothing is being
 * fetched during it, so a determinate fill is the honest shape. The duration
 * comes from `BOOT_MS` so the animation cannot drift from the phase it
 * accompanies.
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
