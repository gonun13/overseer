import { useEffect, useRef, useState } from "react";

/**
 * The headline swaps instantly almost every time it changes — motion here
 * means the system changed state, not decoration (design-system.md §9). Very
 * occasionally it types the new word out instead: a small tell that
 * something is watching, deliberately rare so it never reads as a feature.
 * Never fires on mount — only on a real change from what was already showing.
 */
export function useOccasionalTyping(text: string, chance = 0.15) {
  const [display, setDisplay] = useState(text);
  const [typing, setTyping] = useState(false);
  const prev = useRef(text);

  useEffect(() => {
    if (text === prev.current) return;
    prev.current = text;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced || Math.random() > chance) {
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
        setTyping(false);
      }
    }, 55);

    return () => clearInterval(id);
  }, [text, chance]);

  return { display, typing };
}
