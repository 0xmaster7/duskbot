#!/bin/sh
# uptime checks for dusk.bot, run every minute by dusk-uptime.timer on a box other than the one it watches (the Oracle
# VPS watches the Contabo one). mails the operator once when a check starts failing (after 3 misses in a row) and once
# when it recovers, through Brevo (or Resend).
#   DUSK_UPTIME_STATE     state folder (default /var/lib/dusk-uptime)
#   DUSK_BREVO_API_KEY    a Brevo key (or DUSK_RESEND_API_KEY); DUSK_ALERT_FROM and DUSK_ALERT_TO the addresses
#   DUSK_UPTIME_TARGETS   space-separated name=url pairs (default below)
set -eu

STATE="${DUSK_UPTIME_STATE:-/var/lib/dusk-uptime}"
TARGETS="${DUSK_UPTIME_TARGETS:-site=https://dusk.bot/ installer=https://dusk.bot/install.sh account=https://app.dusk.bot/v1/health link=https://link.dusk.bot/healthz}"
mkdir -p "$STATE"

mail() { # subject text
  [ -n "${DUSK_BREVO_API_KEY:-}${DUSK_RESEND_API_KEY:-}" ] && [ -n "${DUSK_ALERT_TO:-}" ] || { echo "alert (not mailed): $1"; return 0; }
  from="${DUSK_ALERT_FROM:-Dusk Bot uptime <alerts@dusk.bot>}"
  if [ -n "${DUSK_BREVO_API_KEY:-}" ]; then
    body=$(node -e 'const m = process.argv[1].match(/^(.*?)\s*<([^>]+)>$/); console.log(JSON.stringify({ sender: m ? { name: m[1], email: m[2] } : { email: process.argv[1] }, to: [{ email: process.argv[2] }], subject: process.argv[3], textContent: process.argv[4] }))' \
      "$from" "$DUSK_ALERT_TO" "$1" "$2")
    curl -fsS -m 20 -X POST https://api.brevo.com/v3/smtp/email -H "api-key: $DUSK_BREVO_API_KEY" -H "content-type: application/json" -d "$body" >/dev/null || echo "alert mail failed: $1"
  else
    body=$(node -e 'console.log(JSON.stringify({ from: process.argv[1], to: [process.argv[2]], subject: process.argv[3], text: process.argv[4] }))' "$from" "$DUSK_ALERT_TO" "$1" "$2")
    curl -fsS -m 20 -X POST https://api.resend.com/emails -H "authorization: Bearer $DUSK_RESEND_API_KEY" -H "content-type: application/json" -d "$body" >/dev/null || echo "alert mail failed: $1"
  fi
}

for pair in $TARGETS; do
  name=${pair%%=*} url=${pair#*=}
  code=$(curl -4 -s -o /dev/null -m 15 --proto =https -w '%{http_code}' "$url" || true)
  misses=$(cat "$STATE/$name.misses" 2>/dev/null || echo 0)
  if [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 400 ]; then
    if [ "$misses" -ge 3 ]; then mail "UP: $name" "$url answers again ($code) at $(date -u +%FT%TZ)."; fi
    echo 0 > "$STATE/$name.misses"
  else
    misses=$((misses + 1))
    echo "$misses" > "$STATE/$name.misses"
    if [ "$misses" -eq 3 ]; then mail "DOWN: $name" "$url failed three checks in a row (last answer: ${code:-none}) at $(date -u +%FT%TZ)."; fi
  fi
done
