import type { ConsoleInfo } from "@overseer/protocol";
import type { Project } from "../domain";
import type { Activity } from "../status";
import { consoleLight } from "./console-light.ts";

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

/** Reflect what the consoles in each project are doing on its status light. */
export function projectsWithConsoleActivity(
  projects: Project[],
  consoles: ConsoleInfo[],
): Project[] {
  const byProject = new Map<string, Activity>();
  for (const c of consoles) {
    const activity = consoleLight(c);
    if (activity === "idle" || activity === "done") continue;
    const prev = byProject.get(c.projectPath);
    byProject.set(
      c.projectPath,
      prev === undefined ? activity : mergeActivity(prev, activity),
    );
  }
  return projects.map((project) => {
    const activity = byProject.get(project.path);
    if (activity === undefined) return project;
    return { ...project, activity };
  });
}
