import type { ReactNode } from "react";
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
  footerVisible: boolean;
  expanded: boolean;
  turns: Turn[];
  busy: boolean;
  settings: PromptSettings;
  options: PromptOption[];
  openControl: PromptOptionKey | null;
  contextCount: number;
  projectName?: string;
  rightInstrument?: ReactNode;
  onExpand: () => void;
  onCollapse: () => void;
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
  footerVisible,
  expanded,
  turns,
  busy,
  settings,
  options,
  openControl,
  contextCount,
  projectName,
  rightInstrument,
  onExpand,
  onCollapse,
  onSubmit,
  onInspect,
  onToggleControl,
  onSelectControl,
  onOpenContext,
  onOpenHelp,
}: PromptSessionChromeProps) {
  return (
    <>
      {promptVisible && (
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
            projectName={projectName}
            onExpand={onExpand}
            onCollapse={onCollapse}
            onSubmit={onSubmit}
            onInspect={onInspect}
          />
        )}
        {footerVisible && (
          <p className="footer settles-in">
            overseer v{import.meta.env.VITE_APP_VERSION}
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
