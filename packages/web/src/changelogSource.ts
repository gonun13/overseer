import raw from "../../../CHANGELOG.md?raw";
import { parseChangelog, type ChangelogRelease } from "./changelog";

/** The root changelog, parsed once at module load. Split from the parser so the
 * parser stays importable outside Vite (the unit test runs under plain node),
 * and reading a root-level file mirrors `appVersion.ts` (architecture §8.1). */
export const RELEASES: ChangelogRelease[] = parseChangelog(raw);
