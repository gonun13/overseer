import { useEffect, useRef, useState } from "react";
import { mockConsole } from "../../data/mock";
import type { ConsoleLine } from "../../domain";

/**
 * A direct terminal into the adapter's CLI, for operators who already know it.
 * Everything else in Overseer is a considered view of what the agent is doing;
 * this is the escape hatch that admits no view covers everything — you get the
 * raw process, its own slash commands, and its own errors, verbatim.
 *
 * It is the one place output is a terminal rather than a transcript, so it does
 * not follow §7.1's input-dark/output-light split: a console is a single
 * continuous stream on one ground, and breaking it into per-line panels would
 * make it stop reading as a terminal (design-system.md §5.3).
 */
export function ConsoleWindow({ adapter }: { adapter: string }) {
  const [lines, setLines] = useState<ConsoleLine[]>(mockConsole);
  const [value, setValue] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  function submit() {
    const command = value.trim();
    if (!command) return;
    // Placeholder for the real pty stream; replaced when the WS pipe lands.
    setLines((current) => [
      ...current,
      { kind: "in", text: command },
      { kind: "err", text: "not wired up — the console is a mockup for now" },
      { kind: "out", text: "" },
    ]);
    setValue("");
  }

  return (
    <div className="console">
      <div className="console-out no-drag">
        {lines.map((line, i) => (
          <div key={i} className={`console-line ${line.kind}`}>
            {line.kind === "in" && <span className="console-sigil">$</span>}
            <span>{line.text || " "}</span>
          </div>
        ))}
        <div ref={end} />
      </div>

      <div
        className="console-in no-drag"
        onClick={() => input.current?.focus()}
      >
        <span className="console-sigil">$</span>
        <input
          ref={input}
          value={value}
          spellCheck={false}
          autoComplete="off"
          placeholder={adapter ? `send to ${adapter}` : "no adapter attached"}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          aria-label="console input"
        />
      </div>
    </div>
  );
}
