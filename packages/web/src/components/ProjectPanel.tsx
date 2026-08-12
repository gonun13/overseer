import { StatusLight } from "./StatusLight";
import { ChevronIcon } from "./icons";
import type { Project } from "../domain";

/**
 * Top-left, permanent, open by default. It is a **status panel** before it is a
 * selector: the lights on these rows are how the operator sees work happening in
 * projects that are not the active one. Selecting therefore never closes it —
 * only the chevron does.
 *
 * It spans two levels. The collapsed header is a readout, so it stays on the
 * field and blends with the background like the clock does. The list is what
 * you click into to act, so it is a **surface** and only takes on window
 * framing once it opens (design-system.md §6).
 */
export function ProjectPanel({
  projects,
  active,
  open,
  onToggle,
  onSelect,
}: {
  projects: Project[];
  active?: Project;
  open: boolean;
  onToggle: () => void;
  onSelect: (project: Project) => void;
}) {
  return (
    <section className="projects settles-in">
      <div className="projects-head">
        <StatusLight activity={active?.activity ?? "idle"} size={10} />
        <span className="projects-kicker">project</span>
        <span className="projects-value">{active?.name ?? "none"}</span>
        <button
          className="chevron-btn"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? "collapse project list" : "expand project list"}
        >
          <ChevronIcon open={open} />
        </button>
      </div>

      <div className={`projects-list ${open ? "open" : ""}`}>
        {projects.map((project) => (
          <button
            key={project.id}
            className={`project-row ${project.id === active?.id ? "current" : ""}`}
            onClick={() => onSelect(project)}
          >
            <StatusLight activity={project.activity} />
            <span className="project-row-name">{project.name}</span>
            <span className="project-row-branch">
              {project.branch}
              {project.dirty ? " ●" : ""}
            </span>
            {project.note && (
              <span className="project-row-note">{project.note}</span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
