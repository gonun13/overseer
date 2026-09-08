# Changelog

Operator-facing release notes, newest first — what an operator can now do or now sees, one line
each. The `/changelog` window renders this file — so does clicking the version in the footer. The
rules for writing an entry live in
[architecture-design.md §8.4](docs/architecture-design.md#84-changelog).

## 0.3.0 — 2026-09-08

### Added

- Clicking a changed file in the project window opens it, showing what changed since the last
  commit — added lines in green, removed in red — with a toggle to read the file's current contents
  instead. New, deleted and renamed files all show, and a diff too large to display is cut off with
  a note saying so.

### Fixed

- A renamed file is listed under its new name instead of as `old -> new`, so it can be opened.

## 0.2.7 — 2026-09-08

### Fixed

- The usage widget reads Cursor's plan usage again — included spend, auto and API pools, and the
  billing-cycle reset — now taken straight from your Cursor account in under a second instead of
  costing a slow, billed agent turn. If that read is ever unavailable the check falls back to
  asking the CLI, and a report it cannot read is reported as no figures rather than an empty gauge.

## 0.2.6 — 2026-09-08

### Added

- The plans window lists plans when Cursor is the attached provider, reading both the plans Cursor
  writes itself and older ones sitting in the project. A plan that still knows the chat it came
  from resumes that chat when you implement it; one that does not starts a fresh session with the
  plan text carried in.
- Subagents can be created, edited and removed under Cursor, from the same capabilities window
  Claude Code uses. Cursor keeps them with the project, so the "where it lives" choice is not
  offered — and settings only Cursor understands survive an edit here untouched.

## 0.2.5 — 2026-09-07

### Fixed

- Text inside a window can be selected and copied — paths, ids, log lines, diffs and transcript
  text. Tabs and the resize grip stay unselectable so dragging a window leaves no stray highlight.

## 0.2.4 — 2026-09-07

### Added

- Settings has a git access section reporting whether the container's ssh key and identity are set
  up, with a button into a new git config window: generate a key inside the container, copy its
  public half to your git host, test the connection against the hosts your own projects point at,
  and set the name and email commits made from here are authored under.

### Fixed

- A push that fails now says why and what to do — a key that has not been added yet, a remote whose
  host key changed, or an https remote the key cannot apply to.
- Commits the agent makes in a session are authored as you, instead of failing or falling back to
  the machine's own identity.

### Removed

- GitHub CLI support and pull-request creation. The dev loop pushes the reviewed branch and you open
  the pull request on your own git host; closing a request still recognises a squash or rebase merge.

## 0.2.3 — 2026-09-05

### Added

- When the agent asks you a question, the session window shows the question and its options and
  sends back what you pick, instead of an approval that could only be allowed or denied.

### Fixed

- "Allow always" now holds for the rest of the session — the same tool no longer asks again on the
  very next use.

## 0.2.2 — 2026-09-05

### Changed

- The project window opens at the top centre of the field, under the active project readout.
- Changed files in the project window are inked by their fate: deleted red, new green, modified a
  softer green.
- Push is offered only when there is something to send: it stays disabled while changes are
  uncommitted or the remote already has every commit, and says which.
- The changelog window shows one release at a time, with arrows to step between versions.
- Merge to default targets whatever branch the project actually treats as trunk — `main`,
  `master`, or otherwise — instead of assuming `main`.
- The project window's tab names the project it belongs to.

## 0.2.1 — 2026-09-05

### Added

- Permission requests appear inline in the session that raised them: when the agent asks to use a
  tool, the session window offers allow once, allow always, or deny.
- A `/changelog` window listing what changed in each release.
