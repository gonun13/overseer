import type { ReactNode } from "react";
import { overseerVersionLabel } from "../appVersion";
import type { Turn } from "../domain";
import type {
  PromptOption,
  PromptOptionKey,
  PromptSettings,
} from "../prompt";
import { Prompt } from "./Prompt";
import { PromptControls } from "./PromptControls";

interface PromptSessionChromeProps {
  promptVisible: boolean;
  /** The menu arms the focused session, so it comes and goes with one rather
   * than with the terminal it sits beside. */
  controlsVisible: boolean;
  footerVisible: boolean;
  expanded: boolean;
  turns: Turn[];
  busy: boolean;
  settings: PromptSettings;
  options: PromptOption[];
  openControl: PromptOptionKey | null;
  contextCount: number;
  rightInstrument?: ReactNode;
  onExpand: () => void;
  onSubmit: (input: string) => void;
  onInspect: (id: string) => void;
  onToggleControl: (key: PromptOptionKey) => void;
  onSelectControl: (key: PromptOptionKey, value: string) => void;
  onOpenContext: () => void;
  onOpenHelp: () => void;
}

/** Bottom-of-field controls and session chrome for the application shell. */
export function PromptSessionChrome({
  promptVisible,
  controlsVisible,
  footerVisible,
  expanded,
  turns,
  busy,
  settings,
  options,
  openControl,
  contextCount,
  rightInstrument,
  onExpand,
  onSubmit,
  onInspect,
  onToggleControl,
  onSelectControl,
  onOpenContext,
  onOpenHelp,
}: PromptSessionChromeProps) {
  return (
    <>
      {controlsVisible && (
        <PromptControls
          options={options}
          settings={settings}
          openKey={openControl}
          contextCount={contextCount}
          onToggle={onToggleControl}
          onSelect={onSelectControl}
          onOpenContext={onOpenContext}
        />
      )}

      {rightInstrument}

      <div className="dock">
        {promptVisible && (
          <Prompt
            expanded={expanded}
            turns={turns}
            busy={busy}
            settings={settings}
            onExpand={onExpand}
            onSubmit={onSubmit}
            onInspect={onInspect}
          />
        )}
        {footerVisible && (
          <p className="footer settles-in">
            {overseerVersionLabel()}
            {promptVisible && (
              <>
                {" "}
                | ask for{" "}
                <button
                  type="button"
                  className="footer-link"
                  style={{ color: "var(--accent)" }}
                  onClick={onOpenHelp}
                >
                  help
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </>
  );
}
