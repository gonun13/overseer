#!/usr/bin/env bash
# Teardown hook for the `research` step (see lib/steps.sh).

# research is a synchronous, headless one-shot: it explores the workspace
# read-only and writes two files, nothing left mounted, locked, or running
# afterward. Nothing to dismount.
step_teardown_hook() {
  :
}
