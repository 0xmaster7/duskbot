#!/usr/bin/env bash
# draws only the site() part of gen.sh: takes its helpers (H, K, e, T, s) and site() from that file, skips the rest
cd "$(dirname "$0")"
eval "$(grep -E '^(H=|K=|e\(\)|T=|s\(\))' gen.sh)"
eval "$(sed -n '/^site() {/,/^}/p' gen.sh)"
site
