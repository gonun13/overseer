/**
 * Parser for the root `CHANGELOG.md`, which is the single source of the
 * operator-facing release notes the `changelog` window renders.
 *
 * Deliberately line-based rather than a markdown dependency: the file's shape
 * is fixed by CLAUDE.md § Changelog, and the window renders it as plain text.
 * Nothing here throws — a malformed file yields fewer releases, never a blank
 * app.
 */

export interface ChangelogSection {
  /** The `###` heading, e.g. `Added`. */
  heading: string;
  items: string[];
}

export interface ChangelogRelease {
  /** The `##` heading's first token, e.g. `0.2.1` — matched against APP_VERSION. */
  version: string;
  /** Whatever followed the version after a dash. Absent when the heading is bare. */
  date?: string;
  sections: ChangelogSection[];
}

/** `## 0.2.1 — 2026-09-05`, with either dash, or no date at all. */
const RELEASE_HEADING = /^##\s+(\S+)(?:\s*[—–-]\s*(.+))?$/;
const SECTION_HEADING = /^###\s+(.+)$/;
const ITEM = /^[-*]\s+(.+)$/;

/**
 * Releases in the order they are authored (newest first, by convention).
 * Prose before the first `##` is ignored, so the file may carry a free-form
 * header; items outside any `###` land in an unnamed section rather than being
 * dropped.
 */
export function parseChangelog(text: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | undefined;
  let section: ChangelogSection | undefined;

  for (const raw of text.split("\n")) {
    const line = raw.trim();

    const releaseMatch = RELEASE_HEADING.exec(line);
    if (releaseMatch) {
      release = { version: releaseMatch[1]!, sections: [] };
      const date = releaseMatch[2]?.trim();
      if (date) release.date = date;
      releases.push(release);
      section = undefined;
      continue;
    }

    // Everything below only makes sense inside a release.
    if (!release) continue;

    const sectionMatch = SECTION_HEADING.exec(line);
    if (sectionMatch) {
      section = { heading: sectionMatch[1]!.trim(), items: [] };
      release.sections.push(section);
      continue;
    }

    const itemMatch = ITEM.exec(line);
    if (itemMatch) {
      if (!section) {
        section = { heading: "", items: [] };
        release.sections.push(section);
      }
      section.items.push(itemMatch[1]!.trim());
      continue;
    }

    // A non-blank, non-heading line directly under an item is that item's
    // continuation — entries wrap in the file but read as one line.
    if (line && section && section.items.length > 0) {
      const last = section.items.length - 1;
      section.items[last] = `${section.items[last]} ${line}`;
    }
  }

  return releases;
}
