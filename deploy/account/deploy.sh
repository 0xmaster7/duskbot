#!/usr/bin/env bash
# Deploys the account service (apps/dashboard/server with the managed cloud) from this checkout with the deploy CLI
# (deployd on the VPS). Always pass the install and run commands: without them the CLI picks npm and package.json's main.
#   deploy/account/deploy.sh preview      # preview.dusk.bot: the site at /, this page at /app, the API at /v1 and /api
#   deploy/account/deploy.sh production   # app.dusk.bot: the page at the root
# ENV_FILE overrides the env file (default ~/.config/duskbot/account-<target>.env, 0600, names in production.env.example).
set -euo pipefail
target="${1:-}"
case "$target" in
  preview) name=dusk-account; domain=preview.dusk.bot; base=/app/; site=https://preview.dusk.bot ;;
  production) name=dusk-account-prod; domain=app.dusk.bot; base=/; site=https://dusk.bot ;;
  *) echo "usage: $0 preview|production" >&2; exit 2 ;;
esac
env_file="${ENV_FILE:-$HOME/.config/duskbot/account-$target.env}"
[ -f "$env_file" ] || { echo "missing $env_file" >&2; exit 1; }
[ "$(stat -f %Lp "$env_file" 2>/dev/null || stat -c %a "$env_file")" = 600 ] || { echo "$env_file must be mode 600" >&2; exit 1; }
cd "$(dirname "$0")/../.."
# the account service runs TypeScript directly on Node 24 (/opt/node24 on the VPS; the system node is older)
exec "${DEPLOY:-deploy}" . --name "$name" --domain "$domain" --env-file "$env_file" \
  --install "export PATH=/opt/node24/bin:\$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1; corepack pnpm install --frozen-lockfile --ignore-scripts && DUSK_DASHBOARD_BASE=$base DUSK_SITE_URL=$site corepack pnpm build:dashboard" \
  --cmd 'set -a; . ./.env; set +a; mkdir -p "$DUSK_DASHBOARD_DATA"; DUSK_DASHBOARD_PORT=$PORT exec /opt/node24/bin/node apps/dashboard/server/main.ts'
