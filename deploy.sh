#!/usr/bin/env bash
# deploy the dusk.bot site server with the deploy CLI. safe to rerun; a rerun is also how
# install.sh gets refreshed. dusk.bot itself is the account service (deploy/account/deploy.sh production in the
# Dusk Bot repo), which proxies every non-account path to this app on 127.0.0.1:3103; app., dev. and www. are its
# aliases and redirect. before launch dusk.bot's home is the waitlist page on its own and every other page is the full
# site: the landing build runs with DUSK_WAITLIST_HOME=1 (set DUSK_WAITLIST_HOME=0 for the full home page at launch).
#   sites/dusk/deploy.sh            # landing (the app dusk-landing, reached through dusk.bot)
# DUSK_REPO is the Dusk Bot checkout (pages read docs/legal there); INSTALLER overrides where install.sh comes from.
# LANDING_ENV is the landing app's env file (mongodb + brevo for the waitlist, names in .env.example); it is uploaded
# when it exists, otherwise the env already on the server stays.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DUSK_REPO="${DUSK_REPO:-$HOME/Desktop/code/OpenMausBot}"
INSTALLER="${INSTALLER:-$DUSK_REPO/apps/link-service/install.sh}"
LANDING_ENV="${LANDING_ENV:-$HOME/.config/duskbot/site-landing.env}"
DEPLOY="${DEPLOY:-deploy}"
WHICH="${1:-all}"

# app name, domain, site folder
SITES=(
  "dusk-landing dusk-landing.apps.siddz.com landing"
)

# the pages and the legal drafts (docs/legal in the Dusk Bot repo) become the landing site's html
if [ "$WHICH" = all ] || [ "$WHICH" = landing ]; then
  DUSK_WAITLIST_HOME="${DUSK_WAITLIST_HOME:-1}" node "$HERE/build-pages.mjs" "$DUSK_REPO"
  # no deploy with a link, picture or anchor that leads nowhere
  node "$HERE/check-links.mjs"
  if [ "${DUSK_WAITLIST_HOME:-1}" = 1 ]; then
    # the committed build stays the full site (preview.dusk.bot serves it); it is put back once the stage has its copy
    RESTORE=1
  else
    # the live app in the home page's hero is built from the app itself (kept out of this repo: it is 24 MB of build output)
    if [ -f "$DUSK_REPO/apps/site-demo/build.mjs" ]; then (cd "$DUSK_REPO" && node apps/site-demo/build.mjs "$HERE/public/landing/demo"); fi
    [ -f "$HERE/public/landing/demo/index.html" ] || echo "warning: public/landing/demo is missing; the home page falls back to a still picture of the app" >&2
  fi
fi

stage=$(mktemp -d "${TMPDIR:-/tmp}/dusk-sites.XXXXXX")
trap 'rm -rf "$stage"; if [ "${RESTORE:-0}" = 1 ]; then node "$HERE/build-pages.mjs" "$DUSK_REPO" > /dev/null; fi' EXIT

ran=0
for row in "${SITES[@]}"; do
  read -r name domain site <<<"$row"
  [ "$WHICH" = all ] || [ "$WHICH" = "$site" ] || continue
  dir="$stage/$name"
  mkdir -p "$dir/public"
  cp "$HERE/server.js" "$HERE/waitlist-store.js" "$HERE/waitlist-mongo.js" "$HERE/package.json" "$HERE/package-lock.json" "$dir/"
  cp -R "$HERE/public/$site" "$dir/public/$site"
  if [ "$site" = landing ]; then
    [ -f "$INSTALLER" ] || { echo "error: installer not found at $INSTALLER" >&2; exit 1; }
    cp "$INSTALLER" "$dir/public/landing/install.sh"
    (cd "$dir/public/landing" && shasum -a 256 install.sh > install.sh.sha256)
    echo "install.sh from $INSTALLER ($(shasum -a 256 "$INSTALLER" | cut -c1-12))"
  fi
  envargs=()
  [ "$site" = landing ] && [ -f "$LANDING_ENV" ] && envargs=(--env-file "$LANDING_ENV")
  "$DEPLOY" "$dir" --name "$name" --domain "$domain" --install "npm install --omit=dev --no-audit --no-fund" ${envargs[@]+"${envargs[@]}"} \
    --cmd "set -a; [ -f ./.env ] && . ./.env; set +a; exec node server.js $site"
  ran=1
done
[ "$ran" = 1 ] || { echo "usage: $0 [all|landing]" >&2; exit 2; }
