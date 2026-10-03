# Reconcile the CLI harness documentation

The drift audit found settled rules left behind by CLI harness and tiled-window changes.
Document the implemented behavior in the governing sections together:

- Production shares only `/workspace`; development also shares the writable source repo at `/app`,
  accessible to agent shells. Update PROJECT's purpose/requirements, domain's workspace definition,
  architecture's shape and data's storage table. Hot reload needs that mount; the production
  boundary cannot describe development.
- Discovery restores a registered provider choice, otherwise attaches the first authenticated
  provider without starting login. Update domain's provider invariant and data's snapshot rule.
  This uses existing container auth without prompting for a redundant selection.
- Config import/export and subagent editors are removed with the replacement chat UI. Remove their
  active contracts from domain, architecture, data and overseer behaviour's memory section.
  Provider CLI features remain owned by the CLI, per PROJECT requirement 4.
- Reload restores console ids/order and tiles them; standby means no other signal needs attention,
  even while consoles work. Update consoles behaviour, data's browser storage and ui-ux's signals.
- Cursor's loop permissions rely on instructions; only Claude has the documented deny list.
  Update dev-loop behaviour's tool grant. Do not claim enforcement the bundle does not have.

Describe the publishing gate as it exists: `publish` reads the selected request's review artifact,
accepts `approved` or `followups`, and permits an explicit `--force` override. It does not verify a
recorded lifecycle event or sign-off file, and it does not independently gate unpublished stacked
ancestry. Update PROJECT requirement 7, dev-loop behaviour and the loop README without deciding
whether those gaps should later be closed in code.

WebSocket upgrades reject a supplied Origin from another host. CLI hooks do not inspect Origin,
including when one is supplied; their boundary is loopback access plus the hook token. Clarify
PROJECT requirement 3 and architecture's Origin rule.
