import type { Project, Session } from "../domain";
import type { Activity } from "../status";

const ACTIVITY_PRIORITY: Record<Activity, number> = {
  approval: 0,
  attention: 1,
  working: 2,
  waiting: 3,
  done: 4,
  idle: 5,
};

function mergeActivity(a: Activity, b: Activity): Activity {
  return ACTIVITY_PRIORITY[a] <= ACTIVITY_PRIORITY[b] ? a : b;
}

/** Reflect live session activity on project status lights. */
export function projectsWithSessionActivity(
  projects: Project[],
  sessions: Session[],
): Project[] {
  const byProject = new Map<string, Activity>();
  for (const session of sessions) {
    if (session.activity === "idle") continue;
    const prev = byProject.get(session.projectId);
    byProject.set(
      session.projectId,
      prev === undefined ? session.activity : mergeActivity(prev, session.activity),
    );
  }
  return projects.map((project) => {
    const activity = byProject.get(project.id);
    if (activity === undefined) return project;
    return { ...project, activity };
  });
}
