#!/usr/bin/env bash
# Cursor provider stub — documents the bundle contract without implementing
# it. load_provider always fails at provider_check_available with a clear
# message. A future impl must keep all Cursor-specific CLI flags, commands,
# and config under this directory only (never leak into loop/ orchestration).

provider_check_available() {
  # Prefer the stub message over require_cmd so LOOP_PROVIDER=cursor always
  # fails clearly even when the cursor CLI is missing from PATH.
  die "cursor provider is not implemented yet — only the bundle layout is defined" 1
}

provider_structure() {
  die "cursor provider is not implemented yet" 1
}

provider_research() {
  die "cursor provider is not implemented yet" 1
}

provider_scope() {
  die "cursor provider is not implemented yet" 1
}
