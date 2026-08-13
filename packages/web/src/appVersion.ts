import rootPkg from "../../../package.json" with { type: "json" };

/** Root monorepo version — single source for footer and help copy (architecture §8.1). */
export const APP_VERSION = rootPkg.version;

export function overseerVersionLabel(): string {
  return `overseer v${APP_VERSION}`;
}
