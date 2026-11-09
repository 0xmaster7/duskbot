#!/usr/bin/env bash
# deploy the dusk.bot placeholder sites with the deploy CLI. safe to rerun; a rerun is also how
# install.sh gets refreshed.
#   sites/dusk/deploy.sh            # all three
#   sites/dusk/deploy.sh landing    # just dusk.bot (+ /install.sh)
#   sites/dusk/deploy.sh app|dev
# INSTALLER overrides where install.sh is copied from (default: the OpenMausBot checkout).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="${INSTALLER:-$HOME/Desktop/code/OpenMausBot/apps/link-service/install.sh}"
DEPLOY="${DEPLOY:-deploy}"
WHICH="${1:-all}"

# app name, domain, site folder
SITES=(
  "dusk-landing dusk.bot landing"
  "dusk-app app.dusk.bot app"
  "dusk-dev dev.dusk.bot dev"
)

stage=$(mktemp -d "${TMPDIR:-/tmp}/dusk-sites.XXXXXX")
trap 'rm -rf "$stage"' EXIT

ran=0
for row in "${SITES[@]}"; do
  read -r name domain site <<<"$row"
  [ "$WHICH" = all ] || [ "$WHICH" = "$site" ] || continue
  dir="$stage/$name"
  mkdir -p "$dir/public"
  cp "$HERE/server.js" "$HERE/package.json" "$dir/"
  cp -R "$HERE/public/$site" "$dir/public/$site"
  if [ "$site" = landing ]; then
    [ -f "$INSTALLER" ] || { echo "error: installer not found at $INSTALLER" >&2; exit 1; }
    cp "$INSTALLER" "$dir/public/landing/install.sh"
    echo "install.sh from $INSTALLER ($(shasum -a 256 "$INSTALLER" | cut -c1-12))"
  fi
  "$DEPLOY" "$dir" --name "$name" --domain "$domain" --install true \
    --cmd "set -a; [ -f ./.env ] && . ./.env; set +a; exec node server.js $site"
  ran=1
done
[ "$ran" = 1 ] || { echo "usage: $0 [all|landing|app|dev]" >&2; exit 2; }
