import { WTitle } from "./bits";
import { COMMANDS } from "../../commands";

export function HelpWindow() {
  return (
    <div>
      <WTitle>about</WTitle>
      <div className="w-pre">
        {"overseer v0.1 — console for cli coding agents\nadapter: claude-code"}
      </div>

      <WTitle>commands</WTitle>
      <div className="w-pre">
        {COMMANDS.map((c) => `${c.usage.padEnd(20)}${c.help}`).join("\n")}
      </div>

      <WTitle>keys</WTitle>
      <div className="w-pre">
        {[
          "1 .. 4               open a prompt control",
          "                     (while the prompt is closed)",
          "ctrl/cmd + k         open the prompt",
          "ctrl/cmd + p         collapse or expand projects",
          "ctrl/cmd + ,         open settings",
          "esc                  dismiss the topmost thing",
        ].join("\n")}
      </div>

      <WTitle>anything else</WTitle>
      <div className="w-pre">
        {
          "text that matches no command is sent to the\nactive project's session as a prompt."
        }
      </div>
    </div>
  );
}
