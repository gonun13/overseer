#!/usr/bin/env bash
# Teardown hook for the `scope` step (see lib/steps.sh).

# scope is a synchronous, interactive foreground call: it reads two files
# and writes one, with the human answering questions in the same terminal.
# Nothing left mounted, locked, or running afterward. Nothing to dismount.
step_teardown_hook() {
  :
}
