#!/bin/sh
# Run by the App target's "Release gate" build phase. A Release build (the one that is archived for the store) stops here
# when the web bundle it is about to package carries copied material or development leftovers.
set -e
if [ "$CONFIGURATION" != "Release" ]; then
  exit 0
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "error: node is needed to run the release gate (apps/mobile/scripts/release-gate.mjs)"
  exit 1
fi
if ! node "$SRCROOT/../../scripts/release-gate.mjs" "$SRCROOT/App/public"; then
  echo "error: the release gate refused this bundle; see the findings above and docs/mobile-readiness.md"
  exit 1
fi
