import type { ReactNode } from "react";
import { overseerVersionLabel } from "../appVersion";
import { Prompt } from "./Prompt";

interface PromptChromeProps {
  promptVisible: boolean;
  footerVisible: boolean;
  promptFocused: boolean;
  rightInstrument?: ReactNode;
  onPromptFocus: () => void;
  onPromptBlur: () => void;
  onPromptSubmit: (input: string) => void;
  onOpenHelp: () => void;
  onOpenChangelog: () => void;
}

/** Bottom-of-field chrome for the prompt terminal and footer. */
export function PromptChrome({
  promptVisible,
  footerVisible,
  promptFocused,
  rightInstrument,
  onPromptFocus,
  onPromptBlur,
  onPromptSubmit,
  onOpenHelp,
  onOpenChangelog,
}: PromptChromeProps) {
  return (
    <>
      {rightInstrument}

      <div className="dock">
        {promptVisible && (
          <Prompt
            focused={promptFocused}
            onFocus={onPromptFocus}
            onBlur={onPromptBlur}
            onSubmit={onPromptSubmit}
          />
        )}
        {footerVisible && (
          <p className="footer settles-in">
            {/* The version is the changelog's own handle: an operator who
                notices the number is the one asking what changed in it. Reads
                as footer type until hovered — `.footer-link` inherits, so this
                is a word you can click, not a control. */}
            <button
              type="button"
              className="footer-link"
              onClick={onOpenChangelog}
            >
              {overseerVersionLabel()}
            </button>
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
