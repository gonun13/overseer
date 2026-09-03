import { WUnavailable } from "./bits";

/** Opened from a tool turn's inspect control. The target is real — it comes
 * from the turn — but nothing parses that tool's input into a diff yet
 * (architecture-design.md §3, MVP row "Diff rendering for `Edit` / `Write`"). */
export function DiffWindow({ target }: { target: string }) {
  return (
    <div>
      <WUnavailable detail="tool input is not parsed into a diff yet." />
      <div className="w-path">{target}</div>
    </div>
  );
}
