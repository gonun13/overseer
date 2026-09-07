# Changelog

Operator-facing release notes, newest first — what an operator can now do or now sees, one line
each. The `/changelog` window renders this file — so does clicking the version in the footer. The
rules for writing an entry live in
[architecture-design.md §8.4](docs/architecture-design.md#84-changelog).

## 0.2.4 — 2026-09-07

### Added

- Settings has a git access section: generate an ssh key inside the container, copy its public half
  to your git host, and test the connection against the hosts your own projects point at.
- Set the name and email that commits made from here are authored under.

### Fixed

- A push that fails now says why and what to do — a key that has not been added yet, a remote whose
  host key changed, or an https remote the key cannot apply to.

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
