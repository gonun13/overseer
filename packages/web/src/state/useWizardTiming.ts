import { useCallback, useEffect, useRef, type Dispatch } from "react";
import { BOOT_MS, type WelcomeBeat, type WizardAction, type WizardPhase } from "./wizard";

/** How long a typed welcome headline stays up *after typing finishes* before
 * the next beat. Name ask and tone pick wait on the operator, not this timer. */
const WELCOME_MS = 1000;

/** Furniture mounts as soon as discovery completes; this hands the headline
 * back to ordinary derivation a beat later so the transition is legible
 * rather than everything changing in the same frame. */
const SETTLING_MS = 600;

interface WizardTimingState {
  phase: WizardPhase;
  welcomeBeat?: WelcomeBeat;
}

/**
 * Phase timers that are not part of discovery pacing: boot minimum, welcome
 * headline holds, and settling transition.
 */
export function useWizardTiming(
  state: WizardTimingState,
  dispatch: Dispatch<WizardAction>,
) {
  const { phase, welcomeBeat } = state;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const phaseRef = useRef(phase);
  const beatRef = useRef(welcomeBeat);
  phaseRef.current = phase;
  beatRef.current = welcomeBeat;

  // Hold timer for intro → name and greet → discovery. Armed by onHeadlineReady
  // once typing has finished, not when the beat flips.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFor = useRef<string | null>(null);

  /** Start the intro/greet hold once the line is fully on screen. */
  const onHeadlineReady = useCallback((text: string) => {
    if (phaseRef.current !== "welcome") return;
    const beat = beatRef.current;
    if (beat !== "intro" && beat !== "greet") return;
    if (!text || holdFor.current === `${beat}:${text}`) return;
    holdFor.current = `${beat}:${text}`;
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      if (beat === "intro") dispatchRef.current({ type: "intro.done" });
      else dispatchRef.current({ type: "welcome.done" });
    }, WELCOME_MS);
  }, []);

  // Minimum boot beat, then stay until the socket is open. Either can finish
  // first; `boot.ready` / `socket.open` each ask the reducer to leave boot
  // only when both gates are true. Connection wait stays on the loading bar
  // so discovery never sits on "connecting".
  useEffect(() => {
    if (phase !== "boot") return;
    const id = setTimeout(
      () => dispatchRef.current({ type: "boot.ready" }),
      BOOT_MS,
    );
    return () => clearTimeout(id);
  }, [phase]);

  // Drop a pending hold if we leave an auto-advancing beat.
  useEffect(() => {
    if (phase === "welcome" && (welcomeBeat === "intro" || welcomeBeat === "greet")) {
      return () => {
        if (holdTimer.current !== null) clearTimeout(holdTimer.current);
        holdTimer.current = null;
      };
    }
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    holdFor.current = null;
  }, [phase, welcomeBeat]);

  // Furniture mounts as soon as discovery completes; this hands the headline
  // back to ordinary derivation a beat later so the transition is legible
  // rather than everything changing in the same frame.
  useEffect(() => {
    if (phase !== "settling") return;
    const id = setTimeout(
      () => dispatchRef.current({ type: "settled" }),
      SETTLING_MS,
    );
    return () => clearTimeout(id);
  }, [phase]);

  return { onHeadlineReady };
}
