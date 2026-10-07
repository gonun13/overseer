# Codex for ordinary sessions

Codex is promoted from a catalog stub to an app adapter while its CLI is pinned to
`0.160.1` and `loop` remains `none`. Conversations stay in the CLI TUI; short-lived App Server
processes drive ChatGPT device login, quotas and saved-thread operations. API-key entry and
dev-loop support are excluded. Consoles launch with Codex's own sandbox off
(`--sandbox danger-full-access`), since Docker cannot host bubblewrap and the container is the
sandbox, and with its update check off, since the npm prefix is root-owned.

Session minting now takes a project directory and optional prompt. Codex creates a native
thread and sets its name to persist an empty session before launching `codex resume <id>`.
Failed preparation refuses the open; failed spawning removes the prepared thread. Existing
providers retain their local UUID minting. Device sign-in adds `awaiting-browser` and `userCode`
to the shared auth state, replayed to joining tabs. Background and manual quota readings share
the widget; neither runs a model turn or estimates subscription spending from local tokens.

Updated PROJECT requirement 6, architecture §§1–2 and 8, data §3, consoles §2 and §5, UI auth
and usage behavior, dev-loop provider scope and test coverage in the same change.
