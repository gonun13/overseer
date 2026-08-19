import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PersonalityTone } from "@overseer/protocol";
import { LoadingBar } from "./LoadingBar";
import { StatusLight } from "./StatusLight";
import { useOccasionalTyping } from "../state/useOccasionalTyping";
import { TONES } from "../state/wizard";
import type { Signal } from "../state/signals";
import { ACTIVITY_PULSES, type Activity } from "../status";

/** Matches personality.ts / useDiscovery — keep the blank from offering more
 * than the server will store. */
const MAX_NAME = 24;

/** How long name/tone waits for the operator before taking the default. */
const CHOICE_MS = 15_000;

/** Name used when the ask times out with nothing typed. */
const DEFAULT_NAME = "HUMAN";

/** Slower than headline typing — the operator still has a beat to interrupt. */
const TYPE_MS = 200;

/** Pause after the default name has finished typing, before advancing. */
const AFTER_NAME_MS = 2000;

/**
 * The centre of the field. Not a log and not a dashboard: a ranked, derived
 * answer to "what should I be looking at?". Every line is clickable and opens
 * the thing it is talking about (design-system.md §4).
 *
 * During the wizard's opening phases the signal list is empty and the headline
 * is the whole message — that is the "headline-only" state a fresh instance
 * boots into, not a special mode (docs/overseer.md §4).
 */
export function OverseerSpace({
  signals,
  headline,
  loading = false,
  typingChance,
  holdCaret = false,
  onGoodbyeClick,
  onFollow,
  onSubmitName,
  namePrefix = "welcome...",
  onSubmitTone,
  selectedTone = "neutral",
  onHeadlineReady,
}: {
  signals: Signal[];
  headline: { text: string; activity: Activity };
  /** Boot phase (minimum beat and any socket wait); nothing is known yet. */
  loading?: boolean;
  /** From `overseer-personality`, when the operator set one and it passed
   * validation. Undefined leaves `useOccasionalTyping`'s own default. */
  typingChance?: number;
  /** Keep the block caret after typing finishes — the goodbye hold. */
  holdCaret?: boolean;
  /** Goodbye hold: click the headline to reload without waiting out the timer. */
  onGoodbyeClick?: () => void;
  onFollow: (signal: Signal) => void;
  /** First-run welcome: ask for a name inline in the headline. */
  onSubmitName?: (name: string) => void;
  /** Tone-aware prefix for the name ask (`welcome...` and variants). */
  namePrefix?: string;
  /** First-run: three tone choices after the name is known. */
  onSubmitTone?: (tone: PersonalityTone) => void;
  /** Currently highlighted tone while the picker is up. */
  selectedTone?: PersonalityTone;
  /** Fired when the headline is fully visible — typing done, or instant. */
  onHeadlineReady?: (text: string) => void;
}) {
  const asking = onSubmitName !== undefined;
  const pickingTone = onSubmitTone !== undefined;
  // The rule widens for the overseer's own urgency, not a session's — a
  // session working normally never touches this (docs/overseer.md §3).
  const busy = ACTIVITY_PULSES[headline.activity];
  // Keep the typing hook mounted across ask → greet so "welcome, name" types
  // out instead of appearing in one frame (useOccasionalTyping skips mount).
  const { display, typing } = useOccasionalTyping(
    asking ? "\0" : headline.text,
    asking ? 0 : typingChance,
  );

  // Tell the wizard the line is readable. Intro/greet holds start here, not
  // when the beat flips — otherwise the 1s timer races the typing pass.
  useEffect(() => {
    if (!onHeadlineReady || asking || typing) return;
    if (!headline.text || display !== headline.text) return;
    onHeadlineReady(headline.text);
  }, [asking, typing, display, headline.text, onHeadlineReady]);

  return (
    <div className="overseer-space">
      {asking ? (
        <NameAsk prefix={namePrefix} onSubmit={onSubmitName} />
      ) : (
        <>
          {onGoodbyeClick ? (
            <button
              type="button"
              className="os-headline os-headline-restart"
              onClick={onGoodbyeClick}
              title="click to restart"
            >
              {display}
              {(typing || holdCaret) && <span className="os-cursor blink" />}
            </button>
          ) : (
            <p className="os-headline">
              {display}
              {(typing || holdCaret) && <span className="os-cursor blink" />}
            </p>
          )}
          <hr className="os-rule" style={{ width: busy ? 150 : 30 }} />
          {loading ? <LoadingBar /> : <p className="os-marker">▲</p>}
          {pickingTone && (
            <TonePick selected={selectedTone} onSelect={onSubmitTone} />
          )}
        </>
      )}

      <div className="os-signals">
        {signals.map((signal) => (
          <button
            key={signal.id}
            className="os-signal"
            onClick={() => onFollow(signal)}
          >
            <StatusLight activity={signal.activity} />
            <span className="os-kicker">{signal.kicker}</span>
            <span className="os-text">{signal.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** First-run tone choices. Words on the field, not cards — ▪ marks the
 * default/current pick the same way settings marks the active theme.
 * Unattended for CHOICE_MS, the highlighted default is submitted. */
function TonePick({
  selected,
  onSelect,
}: {
  selected: PersonalityTone;
  onSelect: (tone: PersonalityTone) => void;
}) {
  const onSelectRef = useRef(onSelect);
  const selectedRef = useRef(selected);
  onSelectRef.current = onSelect;
  selectedRef.current = selected;

  useEffect(() => {
    const id = setTimeout(() => {
      onSelectRef.current(selectedRef.current);
    }, CHOICE_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="os-tone-pick" role="group" aria-label="tone">
      {TONES.map((tone) => {
        const active = tone === selected;
        return (
          <button
            key={tone}
            type="button"
            className="os-tone-btn"
            aria-pressed={active}
            onClick={() => onSelect(tone)}
          >
            <span className="os-tone-mark">{active ? "▪" : ""}</span>
            {tone}
          </button>
        );
      })}
    </div>
  );
}

/**
 * First-run welcome ask, in the same register as the prompt: typed text, a
 * blinking block cursor, and the rule + ▲ riding under the caret as it moves.
 * Enter submits. Idle for CHOICE_MS with no keystrokes → type DEFAULT_NAME
 * into the blank, then submit; the first keystroke cancels the idle timer.
 */
function NameAsk({
  prefix,
  onSubmit,
}: {
  prefix: string;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState("");
  const [filling, setFilling] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const [caretAt, setCaretAt] = useState(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const afterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    idleTimer.current = setTimeout(() => {
      idleTimer.current = null;
      setFilling(true);
      let i = 0;
      typeTimer.current = setInterval(() => {
        i += 1;
        setValue(DEFAULT_NAME.slice(0, i));
        if (i < DEFAULT_NAME.length) return;
        if (typeTimer.current !== null) clearInterval(typeTimer.current);
        typeTimer.current = null;
        afterTimer.current = setTimeout(() => {
          afterTimer.current = null;
          onSubmitRef.current(DEFAULT_NAME);
        }, AFTER_NAME_MS);
      }, TYPE_MS);
    }, CHOICE_MS);
    return () => {
      if (idleTimer.current !== null) clearTimeout(idleTimer.current);
      if (typeTimer.current !== null) clearInterval(typeTimer.current);
      if (afterTimer.current !== null) clearTimeout(afterTimer.current);
    };
  }, []);

  useLayoutEffect(() => {
    setCaretAt(mirrorRef.current?.offsetWidth ?? 0);
  }, [value]);

  function stopIdleTimer() {
    if (idleTimer.current === null) return;
    clearTimeout(idleTimer.current);
    idleTimer.current = null;
  }

  function submit() {
    const name = value.trim();
    if (!name || filling) return;
    stopIdleTimer();
    onSubmit(name);
  }

  return (
    <div
      className="os-name-ask"
      onClick={() => inputRef.current?.focus()}
    >
      <p className="os-headline os-name-line">
        <span>{prefix}</span>
        <span className="os-name-field">
          {/* Mirror is the visible glyphs; the input is an invisible hit target
              sized to it so the block cursor (not the native caret) is what
              the operator sees. */}
          <span className="os-name-type">
            <span ref={mirrorRef} className="os-name-mirror" aria-hidden>
              {value}
            </span>
            <input
              ref={inputRef}
              className="os-name-input"
              value={value}
              maxLength={MAX_NAME}
              aria-label="your name"
              autoComplete="nickname"
              spellCheck={false}
              readOnly={filling}
              onChange={(e) => {
                if (filling) return;
                stopIdleTimer();
                setValue(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </span>
          <span className="os-cursor blink" />
          <span
            className="os-name-follow"
            style={{ transform: `translateX(${caretAt}px) translateX(-50%)` }}
          >
            <span className="os-name-rule" />
            <span className="os-marker">▲</span>
          </span>
        </span>
        <span>?</span>
      </p>
    </div>
  );
}
