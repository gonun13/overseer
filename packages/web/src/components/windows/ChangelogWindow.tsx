import { useState } from "react";
import { APP_VERSION } from "../../appVersion";
import { RELEASES } from "../../changelogSource";
import { WTitle } from "./bits";

/**
 * The root `CHANGELOG.md`, rendered. Read-only and static, the same shape as
 * `HelpWindow`: the file is the source, this window is a view of it, and
 * nothing here can edit a release note.
 *
 * One release at a time rather than the whole file at once — each entry gets
 * the full width to itself, and the arrows in the header step between them
 * with a sliding panel rather than a hard cut, so moving to an older release
 * reads as travelling back through one strip rather than swapping documents.
 * The running version is where it opens, not filtered to: an operator opens
 * this to see what changed *since* whatever they last ran, so stepping
 * further back has to stay one arrow-press away.
 */
export function ChangelogWindow() {
  const startIndex = Math.max(
    0,
    RELEASES.findIndex((release) => release.version === APP_VERSION),
  );
  const [index, setIndex] = useState(startIndex);

  if (RELEASES.length === 0) {
    // Only reachable if the changelog is emptied or malformed; the window
    // itself works, so this is an empty state and not a `WUnavailable`.
    return <span className="w-empty">no entries yet</span>;
  }

  const count = RELEASES.length;
  // Newest first (changelog.ts), so stepping toward the *older* end of the
  // list slides the strip left — the same direction as scrolling further
  // into history — and toward *newer* slides it back right.
  const atNewest = index === 0;
  const atOldest = index === count - 1;

  return (
    <div>
      <div className="changelog-nav">
        <button
          type="button"
          className="changelog-arrow"
          disabled={atNewest}
          aria-label="newer release"
          onClick={() => setIndex((current) => Math.max(0, current - 1))}
        >
          ‹
        </button>
        <span className="changelog-nav-count">
          {index + 1} / {count}
        </span>
        <button
          type="button"
          className="changelog-arrow"
          disabled={atOldest}
          aria-label="older release"
          onClick={() => setIndex((current) => Math.min(count - 1, current + 1))}
        >
          ›
        </button>
      </div>

      <div className="changelog-viewport">
        <div
          className="changelog-track"
          style={{
            width: `${count * 100}%`,
            transform: `translateX(-${(index * 100) / count}%)`,
          }}
        >
          {RELEASES.map((release) => (
            <div
              className="changelog-slide"
              key={release.version}
              style={{ width: `${100 / count}%` }}
            >
              <WTitle>
                {[
                  release.version,
                  release.date,
                  release.version === APP_VERSION ? "current" : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </WTitle>
              {release.sections.map((section, sectionIndex) => (
                <div className="w-pre" key={`${release.version}-${sectionIndex}`}>
                  {[
                    ...(section.heading ? [section.heading] : []),
                    ...section.items.map((item) => `- ${item}`),
                  ].join("\n")}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
