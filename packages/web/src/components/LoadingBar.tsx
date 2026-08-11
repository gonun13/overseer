/**
 * The boot bar. Shown only while the socket is connecting and there is
 * genuinely nothing else to say — this is the wizard's first beat, not a
 * spinner (spinners are an anti-pattern here; the headline and its rule are
 * the progress indicator for everything else).
 *
 * Under `prefers-reduced-motion` the fill's animation is dropped in CSS and the
 * bar sits full instead — the state still shows, it just stops moving
 * (design-system.md §9).
 */
export function LoadingBar() {
  return (
    <div className="loading-bar" role="progressbar" aria-label="starting">
      <div className="loading-bar-fill" />
    </div>
  );
}
