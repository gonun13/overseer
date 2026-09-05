import { APP_VERSION } from "../../appVersion";
import { RELEASES } from "../../changelogSource";
import { WTitle } from "./bits";

/**
 * The root `CHANGELOG.md`, rendered. Read-only and static, the same shape as
 * `HelpWindow`: the file is the source, this window is a view of it, and
 * nothing here can edit a release note.
 *
 * The running version is marked rather than filtered to — an operator opens
 * this to see what changed *since* whatever they last ran, so older releases
 * have to stay visible.
 */
export function ChangelogWindow() {
  if (RELEASES.length === 0) {
    // Only reachable if the changelog is emptied or malformed; the window
    // itself works, so this is an empty state and not a `WUnavailable`.
    return <span className="w-empty">no entries yet</span>;
  }

  return (
    <div>
      {RELEASES.map((release) => (
        <div key={release.version}>
          <WTitle>
            {[
              release.version,
              release.date,
              release.version === APP_VERSION ? "current" : undefined,
            ]
              .filter(Boolean)
              .join(" · ")}
          </WTitle>
          {release.sections.map((section, index) => (
            <div className="w-pre" key={`${release.version}-${index}`}>
              {[
                ...(section.heading ? [section.heading] : []),
                ...section.items.map((item) => `- ${item}`),
              ].join("\n")}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
