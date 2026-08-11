import { StatusLight } from "./StatusLight";
import type { Project } from "../domain";

/**
 * Top-centre, permanent. Every session, approval and tool call in the app runs
 * against this project, so it is stated plainly at the top of the field and
 * never hidden behind a menu (design-system.md §6).
 */
export function ActiveProject({
  project,
  onPick,
}: {
  project?: Project;
  onPick: () => void;
}) {
  if (!project) {
    return (
      <button className="active-project unset" onClick={onPick}>
        <span className="ap-kicker">active project</span>
        <span className="ap-name">none</span>
        <span className="ap-meta">select a project to begin</span>
      </button>
    );
  }

  return (
    <button className="active-project" onClick={onPick}>
      <span className="ap-kicker">active project</span>
      <span className="ap-name">
        <StatusLight activity={project.activity} size={9} />
        {project.name}
      </span>
      <span className="ap-meta">
        {project.branch} · {project.dirty ? "uncommitted changes" : "clean"} ·{" "}
        {project.path}
      </span>
    </button>
  );
}
