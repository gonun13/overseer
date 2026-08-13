import { useCallback, useEffect, useRef, type Dispatch } from "react";
import {
  BOOT_MS,
  type ResetStage,
  type WelcomeBeat,
  type WizardAction,
  type WizardPhase,
} from "./wizard";

/** How long a typed welcome headline stays up *after typing finishes* before
 * the next beat. Name ask and tone pick wait on the operator, not this timer. */
const WELCOME_MS = 1000;

/** Furniture mounts as soon as discovery completes; this hands the headline
 * back to ordinary derivation a beat later so the transition is legible
 * rather than everything changing in the same frame. */
const SETTLING_MS = 600;

/** How long the overseer's answer to a refused reset stays up *after typing
 * finishes* before the headline goes back to reporting the world. */
const DECLINED_MS = 1800;

/** How long the goodbye stays up *after typing finishes*, caret still
 * blinking, before the reload. A click restarts sooner — this is only the
 * unattended wait. */
const GOODBYE_HOLD_MS = 10_000;

interface WizardTimingState {
  phase: WizardPhase;
  welcomeBeat?: WelcomeBeat;
  reset?: ResetStage;
}

/**
 * Phase timers that are not part of discovery pacing: boot minimum, welcome
 * headline holds, settling transition, and the reset decline/goodbye holds.
 */
export function useWizardTiming(
  state: WizardTimingState,
  dispatch: Dispatch<WizardAction>,
  onGoodbyeHoldEnd?: () => void,
) {
  const { phase, welcomeBeat, reset } = state;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const goodbyeRef = useRef(onGoodbyeHoldEnd);
  goodbyeRef.current = onGoodbyeHoldEnd;

  const phaseRef = useRef(phase);
  const beatRef = useRef(welcomeBeat);
  const resetRef = useRef(reset);
  phaseRef.current = phase;
  beatRef.current = welcomeBeat;
  resetRef.current = reset;

  // Hold timer for intro → name, greet → discovery, declined → ready, and
  // goodbye → reload. Armed by onHeadlineReady once typing has finished.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFor = useRef<string | null>(null);

  /** Start a hold once the line is fully on screen. */
  const onHeadlineReady = useCallback((text: string) => {
    if (!text) return;

    const resetStage = resetRef.current;
    if (resetStage === "declined") {
      const key = `reset:declined:${text}`;
      if (holdFor.current === key) return;
      holdFor.current = key;
      if (holdTimer.current !== null) clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        dispatchRef.current({ type: "reset.dismissed" });
      }, DECLINED_MS);
      return;
    }

    if (resetStage === "goodbye") {
      const key = `reset:goodbye:${text}`;
      if (holdFor.current === key) return;
      holdFor.current = key;
      if (holdTimer.current !== null) clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        goodbyeRef.current?.();
      }, GOODBYE_HOLD_MS);
      return;
    }

    if (phaseRef.current !== "welcome") return;
    const beat = beatRef.current;
    if (beat !== "intro" && beat !== "greet") return;
    if (holdFor.current === `${beat}:${text}`) return;
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

  // Drop a pending hold if we leave an auto-advancing beat or reset stage.
  useEffect(() => {
    const welcomeHold =
      phase === "welcome" &&
      (welcomeBeat === "intro" || welcomeBeat === "greet");
    const resetHold = reset === "declined" || reset === "goodbye";
    if (welcomeHold || resetHold) {
      return () => {
        if (holdTimer.current !== null) clearTimeout(holdTimer.current);
        holdTimer.current = null;
      };
    }
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    holdFor.current = null;
  }, [phase, welcomeBeat, reset]);

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
