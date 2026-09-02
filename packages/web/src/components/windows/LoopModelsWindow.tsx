import { useEffect, useState } from "react";
import type { ProviderOption } from "@overseer/protocol";
import type { LoopConfigState, LoopModelsEntry } from "../../state/useLoopConfig";
import { ChevronIcon } from "../icons";
import { WTitle } from "./bits";

/** `""`/absent both mean "inherit" — the loop step falls back to the CLI's
 * own default, or (for a step) its `model_hint` in `LOOP_STEPS`. */
const INHERIT: ProviderOption = { value: "", label: "inherit" };

/**
 * Model allocation for one loop-runnable provider: the overseer's own model,
 * plus one row per step. Opened from the loop tab of the providers window
 * (`ProvidersWindow`'s `models` action).
 *
 * `entry` comes from `loop/bin/models list-models <providerId>` — that
 * provider's own CLI, asked directly — so it answers for whichever provider
 * this window is for, not just whichever one the app happens to have
 * attached. `undefined` means "not asked yet, or the answer has not landed" —
 * asked once here, on mount; an empty (but present) list means the CLI
 * genuinely reported nothing (not signed in, unreachable), and the window
 * falls back to a free-text field rather than showing a picker with nothing
 * in it.
 */
export function LoopModelsWindow({
  providerId,
  loopConfig,
  entry,
  onReadModels,
  onSetModel,
}: {
  providerId: string;
  loopConfig: LoopConfigState;
  entry: LoopModelsEntry | undefined;
  onReadModels: (providerId: string) => void;
  onSetModel: (slot: string, model: string) => void;
}) {
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    onReadModels(providerId);
  }, [providerId, onReadModels]);

  const provider = loopConfig.providers.find((p) => p.id === providerId);
  if (provider === undefined) {
    return <div className="w-empty">unknown provider</div>;
  }

  const models = entry?.models ?? [];
  const loading = entry === undefined;

  const slots = ["overseer", ...loopConfig.steps];
  const valueFor = (slot: string): string =>
    (slot === "overseer" ? provider.overseer : provider.steps[slot]) ?? "";

  const pick = (slot: string, value: string) => {
    onSetModel(slot, value);
    setOpenSlot(null);
  };

  const toggle = (slot: string) => {
    if (openSlot === slot) {
      setOpenSlot(null);
      return;
    }
    setOpenSlot(slot);
    setDraft(valueFor(slot));
  };

  return (
    <div>
      <WTitle>{providerId} · step models</WTitle>
      {!provider.subagentsVerified && (
        <p className="w-note">
          {providerId} runs every step itself for now — its ability to delegate a
          step to a subagent is not yet confirmed working. only the overseer's
          own model below takes effect until that changes.
        </p>
      )}
      {!loading && models.length === 0 && (
        <p className="w-note">
          {providerId} did not report any models — sign in to it, or check it is
          reachable, then reopen this window. a model id can still be typed by
          hand below.
        </p>
      )}
      {slots.map((slot) => {
        const open = openSlot === slot;
        const value = valueFor(slot);
        const current = models.find((m) => m.value === value);
        return (
          <div key={slot} className={`loop-slot ${open ? "open" : ""}`}>
            <button
              className="loop-slot-head"
              onClick={() => toggle(slot)}
              aria-expanded={open}
              aria-label={`${slot} ${current?.label ?? (value === "" ? "inherit" : value)}`}
            >
              <span className="loop-slot-name">{slot}</span>
              <span className="loop-slot-value">
                {current?.label ?? (value === "" ? "inherit" : value)}
              </span>
              <span className="loop-slot-chevron">
                <ChevronIcon open={open} />
              </span>
            </button>

            {open && loading && <p className="w-note">reading models…</p>}

            {open && !loading && models.length > 0 && (
              <div className="loop-slot-values" role="listbox">
                {[INHERIT, ...models].map((option) => {
                  const selected = option.value === value;
                  return (
                    <button
                      key={option.value || "inherit"}
                      role="option"
                      aria-selected={selected}
                      className={`session-ctl-option ${selected ? "current" : ""}`}
                      onClick={() => pick(slot, option.value)}
                    >
                      <span className="session-ctl-mark">{selected ? "▪" : ""}</span>
                      <span className="session-ctl-option-text">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {open && !loading && models.length === 0 && (
              <div className="btn-row">
                <input
                  className="w-input"
                  type="text"
                  value={draft}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="model id, empty inherits"
                  aria-label={`${slot} model id`}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") pick(slot, draft.trim());
                  }}
                />
                <button type="button" className="w-btn" onClick={() => pick(slot, draft.trim())}>
                  set
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
