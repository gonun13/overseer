# Changelog

Operator-facing release notes, newest first — what an operator can now do or now sees, one line
each. The `/changelog` window renders this file — so does clicking the version in the footer. The
rules for writing an entry live in
[spec/architecture.md §8.4](spec/architecture.md#84-changelog).

## 0.7.2 — 2026-10-08

### Changed

- Every part of the app is now built and type-checked by the same TypeScript version.

## 0.7.1 — 2026-10-08

### Changed

- The production server comes back by itself after a crash or a Docker restart, and Docker reports
  it unhealthy when it stops answering.

## 0.7.0 — 2026-10-07

### Added

- Connect Codex, sign in with ChatGPT using a browser device code, check subscription usage, and
  start, resume or delete saved project sessions in its own terminal UI. Dev-loop support is not
  available for Codex.

### Fixed

- Production builds include the release notes the changelog window reads.

## 0.6.2 — 2026-10-06

### Changed

- The left and right rails take an eighth of the screen each, a little wider than before on small
  screens and narrower on wide ones, leaving more room for your consoles.
- Tiling stacks windows vertically first: a second window opens under the first, and each column
  fills before the next one starts.

## 0.6.1 — 2026-10-04

### Changed

- The overseer's status rows no longer open in a window over your consoles. They sit in the right
  rail from the first discovery step, and the message, signals, status and prompt now stack together
  there, with the version and help under them.
- The provider widget sits at the foot of the left rail, under the session buttons, and is more
  compact: the sign-in state shares the provider's line.
- The session list is one list: shells sit with the agents rather than in a group of their own, and
  each row shows its name and project, without the provider.

## 0.6.0 — 2026-10-04

### Added

- Every agent session gets a callsign — a person's name like Linda — shown on its tab and in the
  session list; `/rename linda lucy` changes it. Tabs now show just the callsign and the
  project, not the session's title; session-list rows show the callsign and project on the left,
  and the provider (or `shell`) with the kill button on the right.
- Type `@linda <message>` in the prompt to send that session a prompt; it is typed in once the
  session is idle and has no half-typed draft of yours, and a session that is not running is
  resumed first. `@linda` alone brings its console up.
- Agents can message each other with `overseer who` and `overseer tell <name> <message>`; an
  agent that sends too often is held for your approval, and `/drop` drops what is held.

### Changed

- The prompt wraps and grows as you type, so a long prompt is shown in full instead of cut off;
  `Shift` + `Enter` starts a new line.

### Fixed

- Documentation and CLI help now match the current commands, configuration, provider status,
  window behavior and dev-loop publishing gate.

## 0.5.1 — 2026-10-03

### Changed

- The field is three columns: projects, sessions and shells on the left; windows in the centre;
  the clock, settings, overseer, prompt and provider on the right.
- Every window — consoles, help, project, diffs — tiles the centre of the field on its own as you
  open and close them; `/tile` puts them back after you drag one.
- `/console` and the provider's NEW SESSION button are gone. Start a session with
  `+ new session` on the left, or by typing a prompt.
- The Claude Code provider is now called `claude`, matching its CLI. If `loop/.provider` or
  `LOOP_PROVIDER` still says `claude-code`, change it to `claude` — the loop refuses to start
  until you do.

### Fixed

- A session you just started shows in the sessions list straight away, instead of only after
  its first reply.
- A console ended by a kill or an interrupt no longer lights up as if it had failed.

## 0.5.0 — 2026-10-02

### Changed

- Overseer is now a harness around the providers' own CLIs. Every session runs in the CLI's real
  terminal, in a console window — the same slash commands, approvals, models and agents you get
  from the CLI itself, as soon as the provider ships them.
- The field is three columns: projects, sessions and shells on the left; windows in the centre;
  the clock, settings, overseer, prompt and provider on the right.
- Open as many consoles as you like, in any project. Every window — consoles, help, project,
  diffs — tiles the centre of the field on its own as you open and close them; `/tile` puts them
  back after you drag one. ctrl+` walks through the consoles.
- Closing a console window no longer ends it. The CLI keeps running, stays in the sessions list
  on the left, and comes back with everything it printed when you open it again. A
  reload puts every window back where it was. Kill is its own button.
- Clicking a session resumes it in a console, or shows the console already running it. The list
  covers every project and every provider, and shows a session from the moment it starts.
- Typing into the prompt bar starts a new session with that as its opening prompt.
- `/shell` opens a plain shell in the active project.
- A Claude Code session waiting on a permission prompt lights up, and the overseer points you to
  its console.
- The Claude Code provider is now called `claude`, matching its CLI.

### Removed

- The chat window, its model / mode / agent controls, inline approvals, the capabilities window
  (skills, subagents, mcp) and the plans window. All of them are in the CLI itself now.
- `/console` and the provider's NEW SESSION button. Every session is a console: start one with
  `+ new session` on the left, or by typing a prompt.

## 0.4.6 — 2026-09-14

### Fixed

- Pushing, committing and the project list no longer fail with "fatal: detected dubious ownership"
  after you run git on the host in the same project.

## 0.4.5 — 2026-09-14

### Fixed

- The block cursor in a session's compose area follows the caret, so you can see where an edit will
  land when you move back through what you typed.

## 0.4.4 — 2026-09-13

### Fixed

- The git identity you save in settings › git access now stays saved. Saving it while the overseer
  was still looking around at startup wrote it and then lost it moments later, so it had to be typed
  in again — as did a theme picked in the same window. Both now survive.
- The project window's "ahead · behind" counts are no longer stale. Nothing in the app ever
  contacted the remote, so those numbers were measured against whatever your checkout last saw —
  a project could sit at "0 behind" while the remote had moved on days earlier. Opening a project
  now fetches its current branch first, and the counts update as soon as that lands.
- Pushing checks the remote before it tries. A push that cannot succeed is now refused up front
  with "the remote has 1 commit this project does not — pull them in first", rather than being
  attempted and reported as "To github.com:you/repo.git" — git's header line, and the one line of
  its output that says nothing about what went wrong. Failures that do reach the remote now quote
  the rejection itself.
- The overseer says when it is talking to a remote. Fetching a project's branch shows in the status
  window while it runs and reports what it found — up to date, how many commits origin is holding,
  or that origin could not be reached at all. That last one matters most: it is when the ahead and
  behind counts on screen stop meaning anything.
- The dev loop's commits are authored as you again. They were landing as `overseer
  <overseer@localhost>` even with an identity saved, because the container was started with four
  empty git variables that git reads ahead of every config file. If you set `GIT_AUTHOR_NAME` and
  friends in `.env`, that still works — but leave them commented out rather than blank.

### Added

- A **pull** button in the project window, offered when origin is holding commits your checkout does
  not have. It merges them in — no rebase, nothing rewritten. If the merge conflicts, the app stops
  and leaves the conflict exactly where git put it, names the files, and hands it to you: resolving
  it is yours to do in the project, and nothing is undone behind your back. It refuses over
  uncommitted work rather than merging into a half-finished change.
- Push is held while origin is ahead, instead of being offered and then refused. The button goes
  live again the moment a pull succeeds — the pull's ack re-reads the project, "behind" comes back
  to nothing, and push is released in the same breath.

## 0.4.3 — 2026-09-13

### Fixed

- Signing in to your provider now clears the "checking provider auth" and "releasing the prompt"
  lines in the overseer's status window. They used to keep saying you were not authenticated and
  that the prompt was held, long after both had stopped being true.

### Changed

- The overseer now speaks in a line rather than a single word. The line above the signal list reads
  in the tone you chose rather than reporting one fixed status word.
- The status window keeps one line per condition instead of stacking a new one each time something
  is re-checked: a line that describes how things stand now corrects itself, while a line about
  something that happened stays put.
- A folder whose git has gone slow now reports once and clears itself when git recovers, rather
  than leaving the complaint sitting under the recovery notice.
- The skills and subagents tabs now say when there is no signed-in provider to ask, instead of
  showing an empty list and an enabled import button — an empty list read as "you have none" when
  in fact nothing had been asked.

## 0.4.2 — 2026-09-13

### Fixed

- The provider readout now says "not signed in" when your provider's session has lapsed, instead
  of holding on to "signed in · usage currently not available" until you opened the console and
  were told the opposite. Anything that finds the session gone — opening the console, starting a
  session, asking for usage — now corrects the readout on the spot.

## 0.4.1 — 2026-09-11

### Fixed

- Clicking a new folder in the project window now lists the files inside it, each one opening its
  own view — and folders within folders open the same way, however deep they go. It used to open an
  empty file view that could never load.

## 0.4.0 — 2026-09-11

### Added

- Import skills from the capabilities window: paste a repository link or pick files off your own
  machine, and choose whether they apply to this project or to every project.
- A link to a whole folder of skills imports all of them at once, passing over the ones you
  already have.
- Skills published as a single markdown file import as readily as ones published as a folder.
- Skills your attached provider can use are listed even when a different provider installed them,
  marked so you can tell whose they are.

## 0.3.4 — 2026-09-09

### Changed

- Your projects now live in a folder beside overseer instead of inside it, so nothing you own sits
  in the folder overseer tears down and rebuilds. If you already have projects, overseer stops on
  the next start and tells you how to move them — nothing is lost in the meantime.

## 0.3.3 — 2026-09-08

### Fixed

- The project window no longer offers a push on a branch that has nothing to send. A branch that
  tracks a remote and matches it now reads as `0 ahead · 0 behind` and greys the push out, saying
  the remote is up to date — previously git's silence about an in-sync branch was read as "never
  pushed", so a clean, fully-pushed branch showed a live push button.

## 0.3.2 — 2026-09-08

### Added

- Stop a turn without waiting it out. A session running something shows a stop next to its
  composer, and its row in the sessions panel and the sessions window shows one too — the agent
  drops what it is doing and the session stays open, ready for the next thing you say.
- `stop all sessions` in settings now works: it stops every session that has a turn running, says
  how many that is, and asks for a second click before doing it.

## 0.3.1 — 2026-09-08

### Fixed

- The dev loop runs against a project that has no remote. It no longer refuses to start work on
  one, stacking each request's branch on the local trunk instead, and approving a review merges
  the work into that trunk rather than pushing it — so a purely local project goes from request to
  landed change without a git host. A project with a remote is unaffected: its branches are still
  pushed for you to open the pull request yourself.
- A project you have only just `git init`ed no longer stops the loop to ask you for a first
  commit. It makes one itself, from whatever the project already contains, so there is a trunk to
  branch from — and the request's own changes still show up as just their own diff.

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
