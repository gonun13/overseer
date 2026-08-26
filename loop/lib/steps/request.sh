#!/usr/bin/env bash
# Teardown hook for the `request` step (see lib/steps.sh).

# request is a synchronous, headless one-shot: stdin capture + a single
# structuring call, nothing left mounted, locked, or running afterward.
# Nothing to dismount.
step_teardown_hook() {
  :
}
