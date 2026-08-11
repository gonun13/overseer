import { WAdapterNote, WTitle } from "./bits";
import { COMMANDS } from "../../commands";
import type { AdapterInfo } from "../../domain";

/** `adapter.name` is empty when none is attached — the about block reports that
 * rather than naming the one it expects to see. */
export function HelpWindow({ adapter }: { adapter: AdapterInfo }) {
  return (
    <div>
      <WAdapterNote adapter={adapter} />
      <WTitle>about</WTitle>
      <div className="w-pre">
        {[
          `overseer v${import.meta.env.VITE_APP_VERSION} — console for cli coding agents`,
          adapter.name ? `adapter: ${adapter.name}` : "adapter: none attached",
        ].join("\n")}
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
