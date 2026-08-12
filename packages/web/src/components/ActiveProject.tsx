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
      <button className="active-project unset settles-in" onClick={onPick}>
        <span className="ap-kicker">active project</span>
        <span className="ap-name">none</span>
        <span className="ap-meta">select a project to begin</span>
      </button>
    );
  }

  return (
    <button className="active-project settles-in" onClick={onPick}>
      <span className="ap-kicker">active project</span>
      <span className="ap-name">
        <StatusLight activity={project.activity} size={9} />
        {project.name}
      </span>
      <span className="ap-meta">{gitMeta(project)}</span>
    </button>
  );
}

/** Branch and dirtiness only — the workspace root is implied. Undefined means
 * git could not answer; never collapse that to "clean" or invent a branch. */
export function gitMeta(project: Project): string {
  const branch = project.branch ?? "branch unknown";
  const status =
    project.dirty === true
      ? "uncommitted changes"
      : project.dirty === false
        ? "clean"
        : "status unknown";
  return `${branch} · ${status}`;
}
