#!/bin/sh
# openmausbot vps installer: the app shows one line to paste on a fresh server,
#   curl -fsSL https://link.apps.siddz.com/i/<token> | sh
# and this script installs everything, reports each step to the app through the link service, and links the server.
# safe to run again: every step checks what is already there, and a server that is already linked is only repaired.
# the link service bakes __LINK_BASE__ and __LINK_TOKEN__ in when it serves /i/<token>; run from a file it takes
# the token as $1 and LINK_BASE from the environment.
# knobs (env): LINK_BASE, OMB_PACKAGE (npm spec or tarball url), BOT_DESKTOP_IMAGE.
set -eu

PLACEHOLDER_BASE="__LINK""_BASE__"
PLACEHOLDER_TOKEN="__LINK""_TOKEN__"
BAKED_BASE="__LINK_BASE__"
BAKED_TOKEN="__LINK_TOKEN__"

if [ -z "${LINK_BASE:-}" ]; then
  if [ "$BAKED_BASE" = "$PLACEHOLDER_BASE" ]; then LINK_BASE="https://link.apps.siddz.com"; else LINK_BASE="$BAKED_BASE"; fi
fi
LINK_BASE=${LINK_BASE%/}
if [ "$BAKED_TOKEN" = "$PLACEHOLDER_TOKEN" ]; then TOKEN="${1:-}"; else TOKEN="$BAKED_TOKEN"; fi

OMB_PACKAGE="${OMB_PACKAGE:-openmausbot@latest}"
ENGINES="@anthropic-ai/claude-code @openai/codex"
# TODO(bot-desktop): set the default to the BOT_DESKTOP_IMAGE constant the bot desktop agent ships (arm64 + amd64).
BOT_DESKTOP_IMAGE="${BOT_DESKTOP_IMAGE:-}"

SVC_USER=maus
SVC_HOME=/home/maus
STATE=/var/lib/openmausbot-link
LOGS=/var/log/openmausbot-link
AGENT=/opt/openmausbot-link/agent.mjs
PORT=8799
UNITS=/etc/systemd/system
export DEBIAN_FRONTEND=noninteractive

say() { printf '%s\n' "$*"; }
fail_line() { printf '\n%s\n' "$*" >&2; }

# ---------- root ----------
become_root() {
  [ "$(id -u)" -eq 0 ] && return 0
  if ! command -v sudo >/dev/null 2>&1; then
    fail_line "Please run this as root (or install sudo), then paste the line again."
    exit 1
  fi
  say "Asking for administrator rights..."
  if [ -r "$0" ] && [ "${0##*/}" != "sh" ] && [ "${0##*/}" != "dash" ]; then
    exec sudo env LINK_BASE="$LINK_BASE" OMB_PACKAGE="$OMB_PACKAGE" BOT_DESKTOP_IMAGE="$BOT_DESKTOP_IMAGE" sh "$0" "$TOKEN"
  fi
  # piped: the script is gone from stdin, so fetch it again for root
  curl -fsSL --retry 3 "$LINK_BASE/i" | sudo env LINK_BASE="$LINK_BASE" OMB_PACKAGE="$OMB_PACKAGE" BOT_DESKTOP_IMAGE="$BOT_DESKTOP_IMAGE" sh -s "$TOKEN"
  exit $?
}

# ---------- helpers ----------
retry() {
  n=1
  while :; do
    if "$@"; then return 0; fi
    [ "$n" -ge 3 ] && return 1
    sleep $((n * 5))
    n=$((n + 1))
  done
}

APT_UPDATED=0
apt_update() {
  [ "$APT_UPDATED" = 1 ] && return 0
  retry apt-get -q -o DPkg::Lock::Timeout=300 update && APT_UPDATED=1
}
apt_install() {
  missing=""
  for pkg in "$@"; do dpkg -s "$pkg" >/dev/null 2>&1 || missing="$missing $pkg"; done
  [ -z "$missing" ] && return 0
  apt_update
  # shellcheck disable=SC2086
  retry apt-get -y -q -o DPkg::Lock::Timeout=300 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold install --no-install-recommends $missing
}
fetch() { retry curl -fsSL --connect-timeout 15 -m 300 "$1" -o "$2"; }

as_user() { runuser -u "$SVC_USER" -- env HOME="$SVC_HOME" PATH="$SVC_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" "$@"; }

state_get() { [ -f "$STATE/$1" ] && cat "$STATE/$1" || true; }
state_set() { printf '%s\n' "$2" > "$STATE/$1.tmp" && mv "$STATE/$1.tmp" "$STATE/$1"; }

json_escape_file() {
  # last lines of a log as one json string body: no control characters, quotes and backslashes escaped
  tail -n 30 "$1" 2>/dev/null | tail -c 3500 | tr -d '\000-\010\013\014\016-\037' | tr '\t' ' ' \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk '{ printf "%s\\n", $0 }'
}

OFFLINE=0
report() { # step status [logfile]
  [ "$OFFLINE" = 1 ] && return 0
  if [ -n "${3:-}" ]; then
    body="{\"step\":\"$1\",\"status\":\"$2\",\"log\":\"$(json_escape_file "$3")\"}"
  else
    body="{\"step\":\"$1\",\"status\":\"$2\"}"
  fi
  curl -fsS -m 15 --retry 2 -X POST -H "authorization: Bearer $VPS_TOKEN" -H "content-type: application/json" \
    --data "$body" "$LINK_BASE/v1/sessions/$LINK_ID/events" >/dev/null 2>&1 || true
}

# plain words for a failed step, printed once in the terminal
failure_words() {
  case "$1" in
    check) say "This server can't run OpenMausBot: it needs Ubuntu or Debian on a 64-bit processor with systemd." ;;
    basics) say "Couldn't install the basic tools. Check this server's internet connection and paste the line again." ;;
    user) say "Couldn't create the account your bots run under." ;;
    node) say "Couldn't install Node. Check this server's internet connection and paste the line again." ;;
    app) say "Couldn't install OpenMausBot. Paste the line again; it picks up where it stopped." ;;
    engines) say "Couldn't install the Claude and ChatGPT tools. Paste the line again; it picks up where it stopped." ;;
    service) say "OpenMausBot didn't start. The app shows the last lines of its log." ;;
    address) say "Couldn't set up this server's address. Paste the line again." ;;
    desktop) say "Couldn't get the bot desktop ready." ;;
    link) say "Couldn't link this server to your app. Make a new line in the app and paste it here." ;;
    *) say "Something went wrong. Paste the line again; it picks up where it stopped." ;;
  esac
}

step() { # id function
  log="$LOGS/$1.log"
  printf '  %-34s' "$(step_title "$1")..."
  report "$1" running
  : > "$log"
  set +e
  ( set -e; "$2" ) </dev/null >>"$log" 2>&1
  code=$?
  set -e
  case "$code" in
    0) say "done"; report "$1" "done"; state_set "step-$1" "done" ;;
    10) say "skipped"; report "$1" skipped "$log"; state_set "step-$1" skipped ;;
    *)
      say "failed"
      report "$1" failed "$log"
      fail_line "$(failure_words "$1")"
      say "Details: $log" >&2
      exit 1 ;;
  esac
}

step_title() {
  case "$1" in
    check) say "Checking your server" ;;
    basics) say "Getting the basics" ;;
    docker) say "Installing Docker" ;;
    user) say "Making a home for your bots" ;;
    node) say "Installing Node" ;;
    app) say "Installing OpenMausBot" ;;
    engines) say "Installing Claude and ChatGPT" ;;
    service) say "Starting OpenMausBot" ;;
    address) say "Setting up the connection" ;;
    desktop) say "Getting the bot desktop ready" ;;
    link) say "Linking to your app" ;;
  esac
}

# ---------- steps ----------
do_check() {
  arch=$(dpkg --print-architecture 2>/dev/null || uname -m)
  case "$arch" in arm64|aarch64|amd64|x86_64) ;; *) echo "unsupported processor: $arch"; return 1 ;; esac
  [ -r /etc/os-release ] || { echo "no /etc/os-release"; return 1; }
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in ubuntu|debian) ;; *) echo "unsupported system: ${ID:-unknown}"; return 1 ;; esac
  [ -d /run/systemd/system ] || { echo "systemd is not running"; return 1; }
  echo "system: ${PRETTY_NAME:-$ID} ($arch)"
  echo "memory: $(awk '/MemTotal/ { printf "%d MB", $2 / 1024 }' /proc/meminfo)"
  free_kb=$(df -Pk / | awk 'NR == 2 { print $4 }')
  echo "free disk: $((free_kb / 1024)) MB"
  if [ "$free_kb" -lt 3000000 ]; then echo "needs at least 3 GB of free disk"; return 1; fi
}

do_basics() {
  apt_install curl ca-certificates gnupg iproute2 procps tar xz-utils
}

do_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    apt_install docker.io || { echo "docker could not be installed; bots still work, the bot desktop will not"; return 10; }
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
  if ! docker info >/dev/null 2>&1; then
    echo "docker is installed but not running here; bots still work, the bot desktop will not"
    return 10
  fi
  docker --version
}

do_user() {
  if ! id "$SVC_USER" >/dev/null 2>&1; then
    useradd --create-home --home-dir "$SVC_HOME" --shell /bin/bash "$SVC_USER"
  fi
  # the docker group is root-equivalent; the server is the person's own, and the bot desktop needs it
  if getent group docker >/dev/null 2>&1; then usermod -aG docker "$SVC_USER"; fi
  for dir in "$SVC_HOME/.local" "$SVC_HOME/.config" "$SVC_HOME/.config/openmausbot" "$SVC_HOME/.config/openmausbot-link"; do
    install -d -o "$SVC_USER" -g "$SVC_USER" -m 0700 "$dir"
  done
  id "$SVC_USER"
}

node_major() { /usr/bin/node -v 2>/dev/null | sed -e 's/^v//' -e 's/\..*//'; }
do_node() {
  major=$(node_major)
  if [ -n "$major" ] && [ "$major" -ge 24 ]; then node_version_line; return 0; fi
  install -d -m 0755 /etc/apt/keyrings
  fetch https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key "$TMP/nodesource.key"
  gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg "$TMP/nodesource.key"
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  APT_UPDATED=0
  apt_update
  retry apt-get -y -q -o DPkg::Lock::Timeout=300 install nodejs
  major=$(node_major)
  [ -n "$major" ] && [ "$major" -ge 24 ] || { echo "node 24 did not install"; return 1; }
  node_version_line
}
node_version_line() { echo "node $(/usr/bin/node -v), npm $(/usr/bin/npm -v 2>/dev/null || echo none)"; }

do_app() {
  bin="$SVC_HOME/.local/bin/openmausbot"
  if [ -x "$bin" ] && [ "$(state_get package)" = "$OMB_PACKAGE" ]; then echo "already installed: $OMB_PACKAGE"; return 0; fi
  retry as_user npm install --global --no-fund --no-audit --prefix "$SVC_HOME/.local" "$OMB_PACKAGE"
  [ -x "$bin" ] || { echo "openmausbot is missing after install"; return 1; }
  state_set package "$OMB_PACKAGE"
}

do_engines() {
  if [ -x "$SVC_HOME/.local/bin/claude" ] && [ -x "$SVC_HOME/.local/bin/codex" ]; then echo "already installed"; return 0; fi
  # shellcheck disable=SC2086
  retry as_user npm install --global --no-fund --no-audit --prefix "$SVC_HOME/.local" $ENGINES
}

# writes a file only when it changed; returns 0 when it wrote
put_file() { # path mode
  if [ -f "$1" ] && cmp -s "$TMP/new" "$1"; then return 1; fi
  install -m "$2" "$TMP/new" "$1"
  return 0
}

server_unit() {
  public=""
  [ "$(state_get mode)" = "direct" ] && public=" --public-url https://$(state_get host)"
  cat > "$TMP/new" <<EOF
# managed by openmausbot-link
[Unit]
Description=OpenMausBot server
After=network-online.target
Wants=network-online.target

[Service]
User=$SVC_USER
WorkingDirectory=$SVC_HOME
Environment=HOME=$SVC_HOME
Environment=PATH=$SVC_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=-$SVC_HOME/.config/openmausbot/engines.env
ExecStart=$SVC_HOME/.local/bin/openmausbot serve --port $PORT --no-pair --label $NAME$public
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  put_file "$UNITS/openmausbot.service" 0644
}

helper_units() {
  changed=1
  cat > "$TMP/new" <<EOF
# managed by openmausbot-link: restarts the server when the app sends a new engine sign-in
[Unit]
Description=OpenMausBot engine sign-in changed

[Path]
PathChanged=$SVC_HOME/.config/openmausbot/engines.env
Unit=openmausbot-restart.service

[Install]
WantedBy=multi-user.target
EOF
  put_file "$UNITS/openmausbot-engines.path" 0644 && changed=0
  cat > "$TMP/new" <<EOF
# managed by openmausbot-link
[Unit]
Description=Restart OpenMausBot after an engine sign-in

[Service]
Type=oneshot
ExecStart=/bin/systemctl restart openmausbot.service
EOF
  put_file "$UNITS/openmausbot-restart.service" 0644 && changed=0
  cat > "$TMP/new" <<EOF
# managed by openmausbot-link: the outbound tunnel and control channel to the app
[Unit]
Description=OpenMausBot link
After=network-online.target openmausbot.service
Wants=network-online.target

[Service]
User=$SVC_USER
Environment=HOME=$SVC_HOME
ExecStart=/usr/bin/node $AGENT tunnel
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  put_file "$UNITS/openmausbot-link.service" 0644 && changed=0
  return "$changed"
}

wait_health() { # url seconds
  i=0
  while [ "$i" -lt "$2" ]; do
    if curl -fsS -m 3 "$1" >/dev/null 2>&1; then return 0; fi
    sleep 2
    i=$((i + 2))
  done
  return 1
}

do_service() {
  reload=1
  server_unit && reload=0
  helper_units && reload=0
  [ "$reload" = 0 ] && systemctl daemon-reload
  systemctl enable openmausbot.service openmausbot-engines.path >/dev/null 2>&1
  systemctl start openmausbot-engines.path
  if [ "$reload" = 0 ]; then systemctl restart openmausbot.service; else systemctl start openmausbot.service; fi
  if wait_health "http://127.0.0.1:$PORT/api/health" 120; then echo "server answers on 127.0.0.1:$PORT"; return 0; fi
  echo "the server did not answer on 127.0.0.1:$PORT within two minutes"
  journalctl -u openmausbot.service -n 30 --no-pager 2>/dev/null || true
  return 1
}

get_agent() {
  install -d -o root -g root -m 0755 /opt/openmausbot-link
  if fetch "$LINK_BASE/agent.mjs" "$TMP/agent.mjs"; then
    install -o root -g root -m 0644 "$TMP/agent.mjs" "$AGENT"
  elif [ ! -f "$AGENT" ]; then
    echo "could not download the link agent"; return 1
  fi
}

caddy_setup() { # host
  if ! command -v caddy >/dev/null 2>&1; then
    apt_install debian-keyring debian-archive-keyring apt-transport-https
    fetch https://dl.cloudsmith.io/public/caddy/stable/gpg.key "$TMP/caddy.key"
    gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg "$TMP/caddy.key"
    chmod 0644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    fetch https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt /etc/apt/sources.list.d/caddy-stable.list
    APT_UPDATED=0
    apt_install caddy
  fi
  cat > "$TMP/new" <<EOF
# managed by openmausbot-link
$1 {
	tls {
		# the app pins this server's key, so renewals keep it
		reuse_private_keys
	}
	encode zstd gzip
	handle /hooks/* {
		reverse_proxy 127.0.0.1:8800
	}
	handle {
		reverse_proxy 127.0.0.1:$PORT {
			flush_interval -1
		}
	}
}
EOF
  install -d -m 0755 /etc/caddy
  put_file /etc/caddy/openmausbot.caddy 0644 || true
  main=/etc/caddy/Caddyfile
  if [ ! -f "$main" ] || grep -q "managed by openmausbot-link" "$main" || grep -q "/usr/share/caddy" "$main"; then
    printf '# managed by openmausbot-link\nimport /etc/caddy/openmausbot.caddy\n' > "$main"
  elif ! grep -q "import /etc/caddy/openmausbot.caddy" "$main"; then
    # someone else's caddy: add our site, never replace theirs
    printf '\nimport /etc/caddy/openmausbot.caddy\n' >> "$main"
  fi
  caddy validate --adapter caddyfile --config "$main"
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 80/tcp && ufw allow 443/tcp
  fi
  systemctl enable caddy >/dev/null 2>&1
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
}

do_address() {
  get_agent
  mode=$(state_get mode)
  host=$(state_get host)
  if [ "$mode" = "direct" ] && [ -n "$host" ] && curl -fsS -m 5 "https://$host/api/health" >/dev/null 2>&1; then
    echo "direct: https://$host still works"; return 0
  fi
  if [ "$OFFLINE" = 1 ]; then
    echo "already linked; keeping the ${mode:-relay} connection"; return 0
  fi
  set +e
  out=$(LINK_BASE="$LINK_BASE" LINK_ID="$LINK_ID" LINK_TOKEN="$VPS_TOKEN" /usr/bin/node "$AGENT" probe 2>&1)
  code=$?
  set -e
  echo "$out"
  ip=$(printf '%s\n' "$out" | sed -n 's/^ip=\([0-9.]*\)$/\1/p' | head -n 1)
  if [ "$code" -ne 0 ] || [ -z "$ip" ]; then
    echo "not reachable from the internet directly; using the private relay (nothing inbound is opened)"
    state_set mode relay
    return 0
  fi
  host="$(printf '%s' "$ip" | tr . -).sslip.io"
  echo "reachable directly; setting up https://$host"
  if ! caddy_setup "$host"; then
    echo "https setup failed; using the private relay instead"
    state_set mode relay
    return 0
  fi
  state_set mode direct
  state_set host "$host"
  server_unit && systemctl daemon-reload && systemctl restart openmausbot.service
  if wait_health "https://$host/api/health" 120; then echo "https://$host answers"; return 0; fi
  echo "https://$host did not answer in two minutes; using the private relay instead"
  state_set mode relay
  server_unit && systemctl daemon-reload && systemctl restart openmausbot.service
  wait_health "http://127.0.0.1:$PORT/api/health" 120 || true
  return 0
}

desktop_first_start() {
  # TODO(bot-desktop): start the bot desktop once the way the server will run it (name, ports, volumes come from the
  # bot desktop agent). until then the pull alone makes the first bot computer start fast.
  :
}

do_desktop() {
  if [ -z "$BOT_DESKTOP_IMAGE" ]; then echo "no bot desktop image configured yet"; return 10; fi
  if ! docker info >/dev/null 2>&1; then echo "docker is not running"; return 10; fi
  retry docker pull "$BOT_DESKTOP_IMAGE"
  docker image inspect "$BOT_DESKTOP_IMAGE" >/dev/null
  desktop_first_start
}

do_link() {
  [ -f "$AGENT" ] || get_agent
  set +e
  runuser -u "$SVC_USER" -- env HOME="$SVC_HOME" LINK_BASE="$LINK_BASE" LINK_ID="$LINK_ID" LINK_TOKEN="$VPS_TOKEN" \
    LINK_MODE="$(state_get mode)" LINK_HOST="$(state_get host)" LINK_NAME="$NAME" /usr/bin/node "$AGENT" link
  code=$?
  set -e
  case "$code" in 0|4) ;; *) return 1 ;; esac
  state_set linked "$LINK_ID"
  start_link_service
}

start_link_service() {
  helper_units && systemctl daemon-reload
  systemctl enable openmausbot-link.service >/dev/null 2>&1
  systemctl restart openmausbot-link.service
}

# ---------- session ----------
claim() {
  arch=$(dpkg --print-architecture 2>/dev/null || uname -m)
  # shellcheck disable=SC1091
  os=$(. /etc/os-release 2>/dev/null && echo "${ID:-unknown}-${VERSION_ID:-}")
  n=0
  while :; do
    status=$(curl -sS -m 20 -o "$TMP/claim" -w '%{http_code}' -X POST -H "authorization: Bearer $VPS_TOKEN" \
      -H "content-type: application/json" --data "{\"host\":{\"arch\":\"$arch\",\"os\":\"$os\"}}" \
      "$LINK_BASE/v1/sessions/$LINK_ID/claim" 2>/dev/null) || status=000
    case "$status" in 000|5*) ;; *) break ;; esac
    n=$((n + 1))
    if [ "$n" -ge 3 ]; then
      fail_line "Can't reach the link service. Check this server's internet connection and paste the line again."
      exit 1
    fi
    sleep $((n * 5))
  done
  case "$status" in
    200) state_set id "$LINK_ID" ;;
    410|404)
      if [ -n "$(state_get linked)" ]; then OFFLINE=1; return 0; fi
      if [ "$status" = 410 ]; then fail_line "This line was already used. Make a new one in the app."; else fail_line "This command expired. Make a new one in the app."; fi
      exit 1 ;;
    401) fail_line "This line doesn't match. Copy it again from the app."; exit 1 ;;
    *) fail_line "The link service said no ($status). Make a new line in the app and try again."; exit 1 ;;
  esac
}

main() {
  case "$TOKEN" in
    [a-z2-7][a-z2-7][a-z2-7][a-z2-7][a-z2-7][a-z2-7][a-z2-7][a-z2-7][a-z2-7][a-z2-7]-*) ;;
    *) fail_line "This line is missing its code. Copy the whole line from the app."; exit 1 ;;
  esac
  LINK_ID=${TOKEN%%-*}
  SECRET=${TOKEN#*-}
  if [ "${#SECRET}" -ne 26 ] || printf '%s' "$SECRET" | grep -q '[^a-z2-7]'; then
    fail_line "This line is missing its code. Copy the whole line from the app."; exit 1
  fi
  become_root
  umask 022
  install -d -m 0700 "$STATE"
  install -d -m 0700 "$LOGS"
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  trap 'exit 130' INT TERM
  command -v curl >/dev/null 2>&1 || apt_install curl ca-certificates </dev/null >/dev/null
  VPS_TOKEN=$(printf '%s' "omb-link-v1|vps|$SECRET" | sha256sum | cut -d' ' -f1)
  NAME=$(hostname -s 2>/dev/null | tr -cd 'A-Za-z0-9.-' | cut -c1-40)
  [ -n "$NAME" ] || NAME=vps

  say ""
  say "Setting up OpenMausBot on this server. This takes a few minutes."
  say ""
  claim
  [ "$OFFLINE" = 1 ] && say "This server is already linked. Checking everything is up to date."

  step check do_check
  step basics do_basics
  step docker do_docker
  step user do_user
  step node do_node
  step app do_app
  step engines do_engines
  step service do_service
  step address do_address
  step desktop do_desktop
  if [ "$OFFLINE" = 1 ]; then
    [ -f "$AGENT" ] && start_link_service
    say ""
    say "Your server is already linked. Everything is up to date."
    return 0
  fi
  step link do_link
  say ""
  say "All set. Your app is finishing up; you can close this window."
}

main "$@"
