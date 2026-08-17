import { overseerVersionLabel } from "../../appVersion";
import { WProviderNote, WTitle } from "./bits";
import { COMMANDS } from "../../commands";
import type { ProviderInfo } from "../../domain";

/** `provider.name` is empty when none is attached — the about block reports that
 * rather than naming the one it expects to see. */
export function HelpWindow({ provider }: { provider: ProviderInfo }) {
  return (
    <div>
      <WProviderNote provider={provider} />
      <WTitle>about</WTitle>
      <div className="w-pre">
        {[
          `${overseerVersionLabel()} · console for cli coding agents`,
          provider.name
            ? `provider: ${provider.name}`
            : "provider: none attached",
        ].join("\n")}
      </div>

      <WTitle>commands</WTitle>
      <div className="w-pre">
        {COMMANDS.map((c) => `/${c.name.padEnd(19)}${c.help}`).join("\n")}
      </div>

      <WTitle>keys</WTitle>
      <div className="w-pre">
        {[
          "1 .. 4               open a session control",
          "                     (focused session, prompt unfocused)",
          "ctrl/cmd + k         open the prompt",
          "ctrl/cmd + p         collapse or expand projects",
          "ctrl/cmd + ,         open settings",
          "/                    start a command; tab completes",
          "esc                  dismiss the topmost thing",
        ].join("\n")}
      </div>

      <WTitle>anything else</WTitle>
      <div className="w-pre">
        {
          "text that does not start with / is sent to the\nactive project's session, starting one if none is active."
        }
      </div>
    </div>
  );
}
