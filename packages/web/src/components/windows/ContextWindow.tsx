import { WAdapterNote, WRow, WTitle } from "./bits";
import { mockContextFiles } from "../../data/mock";
import type { AdapterInfo } from "../../domain";

/** Summoned from prompt control 4. What extra material rides along with the next
 * prompt — the only prompt option that needs more than a value to express. */
export function ContextWindow({
  projectName,
  adapter,
}: {
  projectName?: string;
  adapter: AdapterInfo;
}) {
  return (
    <div>
      <WAdapterNote adapter={adapter} />
      <WTitle>attached to the next prompt</WTitle>
      {mockContextFiles.length === 0 ? (
        <div className="w-empty">nothing attached</div>
      ) : (
        mockContextFiles.map((f) => (
          <WRow
            key={f.path}
            activity="done"
            primary={f.path}
            right={f.tokens}
            actions={<button className="w-btn danger">detach</button>}
          />
        ))
      )}

      <WTitle>from {projectName ?? "no project"}</WTitle>
      <div className="btn-row">
        <button className="w-btn">+ file</button>
        <button className="w-btn">+ git diff</button>
        <button className="w-btn">+ terminal output</button>
      </div>
    </div>
  );
}
