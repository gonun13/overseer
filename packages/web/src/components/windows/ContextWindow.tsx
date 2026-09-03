import { WProviderNote, WTitle, WUnavailable } from "./bits";
import type { ProviderInfo } from "../../domain";

/** Summoned from a session's context control. What extra material rides along
 * with the next turn — the only session option that needs more than a value to
 * express.
 *
 * The attach controls are disabled rather than removed: the window's job is to
 * say what riding along with a turn will look like, and an empty frame would
 * say nothing at all. */
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
      <WUnavailable detail="nothing can be attached to a turn yet." />
      <WTitle>attached to the next turn</WTitle>
      <div className="w-empty">nothing attached</div>

      <WTitle>from {projectName ?? "no project"}</WTitle>
      <div className="btn-row">
        <button className="w-btn" disabled>
          + file
        </button>
        <button className="w-btn" disabled>
          + git diff
        </button>
        <button className="w-btn" disabled>
          + terminal output
        </button>
      </div>
    </div>
  );
}
