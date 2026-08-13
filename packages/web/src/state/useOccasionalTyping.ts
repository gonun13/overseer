import { useEffect, useRef, useState } from "react";

/**
 * The headline swaps instantly almost every time it changes — motion here
 * means the system changed state, not decoration (design-system.md §9). Very
 * occasionally it types the new word out instead: a small tell that
 * something is watching, deliberately rare so it never reads as a feature.
 * Never fires on mount — only on a real change from what was already showing.
 *
 * `prev` is only advanced when a pass finishes (typed or instant). Updating it
 * at the start would let React Strict Mode's effect cleanup-and-replay see the
 * new text as already handled and leave the line blank or half-typed — which
 * is how a forced type (chance ≥ 1) can still appear to "not have" the
 * animation.
 */
export function useOccasionalTyping(text: string, chance = 0.15) {
  const [display, setDisplay] = useState(text);
  const [typing, setTyping] = useState(false);
  const prev = useRef(text);

  useEffect(() => {
    if (text === prev.current) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // chance ≥ 1 is "always" — do not roll. A float compare against Math.random
    // is how a forced type used to lose to a remount and look optional.
    if (reduced || chance < 1 && Math.random() > chance) {
      prev.current = text;
      setDisplay(text);
      setTyping(false);
      return;
    }

    setTyping(true);
    setDisplay("");
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setDisplay(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(id);
        prev.current = text;
        setTyping(false);
      }
    }, 55);

    return () => clearInterval(id);
  }, [text, chance]);

  return { display, typing };
}
