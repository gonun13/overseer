import { WProviderNote, WTitle } from "./bits";
import type { ProviderInfo } from "../../domain";

/** Summoned from prompt control 4. What extra material rides along with the next
 * prompt — the only prompt option that needs more than a value to express. */
export function ContextWindow({
  projectName,
  provider,
}: {
  projectName?: string;
  provider: ProviderInfo;
}) {
  return (
    <div>
      <WProviderNote provider={provider} />
      <WTitle>attached to the next prompt</WTitle>
      <div className="w-empty">nothing attached</div>

      <WTitle>from {projectName ?? "no project"}</WTitle>
      <div className="btn-row">
        <button className="w-btn">+ file</button>
        <button className="w-btn">+ git diff</button>
        <button className="w-btn">+ terminal output</button>
      </div>
    </div>
  );
}
