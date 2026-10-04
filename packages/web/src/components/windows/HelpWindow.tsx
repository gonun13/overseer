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
          "ctrl + `             next console window (works inside one)",
          "ctrl/cmd + k         open the prompt",
          "ctrl/cmd + p         collapse or expand projects",
          "ctrl/cmd + ,         open settings",
          "/                    start a command; tab completes",
          "@                    address an agent by callsign; tab completes",
          "esc                  dismiss the topmost thing",
          "                     (inside a console, keys belong to the cli)",
        ].join("\n")}
      </div>

      <WTitle>anything else</WTitle>
      <div className="w-pre">
        {
          "@linda <message> types the message into linda's cli\nonce it is idle; @linda alone brings it up.\n\ntext that does not start with / or @ starts a new session\nin the active project, with it as the opening prompt.\n+ new session and + shell on the left do the same\nwithout one.\n\nconsoles tile the centre of the field on their own;\n/tile puts them back after a drag.\n\nclosing a console window only detaches it — the cli\nkeeps running and stays in the sessions list. kill\nends it."
        }
      </div>
    </div>
  );
}
