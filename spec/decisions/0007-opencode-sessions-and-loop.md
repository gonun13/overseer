# opencode for sessions and the dev loop; GitHub Copilot dropped

`opencode` is promoted from a catalog stub to `adapter`/`bundle`, with `loopSubagents:
"unverified"`, against its CLI pinned at `1.19.4`. `github-copilot` is removed from the registry
and the image: it was a stub nothing could drive, and an operator who attached it falls back to
the first ready provider on the next discovery.

opencode fronts many model providers and answers on free models with no credential, so it has
no account to sign in to. Connecting providers stays in its TUI; the adapter declares `login:
false`, and status means *ready* (the CLI answers and lists a model) rather than signed in. The
UI therefore reads the adapter's own clause for such a provider, grows no sign-in or sign-out
control for it, and points a not-ready one at the providers window. It reads no usage.

The CLI cannot adopt an id, and `--prompt` is ignored beside `--session`. New sessions are
created empty through a short-lived, password-protected `opencode serve`, and a plugin from the
adapter's build — loaded through `OPENCODE_CONFIG_CONTENT`, which merges with the operator's
config — sends the opening prompt, reports activity to the hook endpoint and carries the relay
brief. Sessions are read from the CLI's SQLite database and deleted through its CLI; adapters
may now say which files under their watch path count as a session change.

The loop contract gains two optional functions so a bundle can create the run's session itself
(`provider_mint_session`, `provider_discard_session`); the opencode bundle uses them with the
same plugin for its kickoff prompt, and isolates its config through `XDG_CONFIG_HOME` and the
CLI's project and Claude Code switches.

Updated PROJECT requirement 6, architecture §§1–3 and 8, consoles §2 and §5, data §3, the UI's
provider sign-in notes, dev-loop provider abstraction and test coverage in the same change.
