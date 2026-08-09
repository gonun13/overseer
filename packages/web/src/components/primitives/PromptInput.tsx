import { useState } from "react";

export function PromptInput({ onSubmit }: { onSubmit?: (text: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="flex items-start gap-2 border-t border-border px-4 py-3">
      <span className="pt-[2px] text-accent">&gt;</span>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            onSubmit?.(value);
            setValue("");
          }
        }}
        placeholder="Message the agent — Ctrl+Enter to send"
        rows={1}
        className="max-h-[8lh] w-full resize-none bg-transparent font-mono text-[13.5px] text-text placeholder:text-text-faint focus:outline-none"
      />
    </div>
  );
}
