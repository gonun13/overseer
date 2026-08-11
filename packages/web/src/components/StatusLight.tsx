import { ACTIVITY_PULSES, type Activity } from "../status";

/**
 * The round light. The only circle in the interface, and the only thing that
 * animates on its own — an unlit ring means idle, so a screen of rings is a
 * screen with nothing happening on it (design-system.md §3).
 *
 * Colour comes from `--light-*`, which the field, surfaces and stamps each
 * re-point, so one component is correct on every ground.
 */
export function StatusLight({
  activity,
  size = 9,
}: {
  activity: Activity;
  size?: number;
}) {
  return (
    <span
      className={`light ${activity} ${ACTIVITY_PULSES[activity] ? "pulse" : ""}`}
      aria-label={activity}
      style={{ width: size, height: size }}
    />
  );
}
