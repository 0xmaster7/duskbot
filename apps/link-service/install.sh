#!/bin/sh
# duskbot vps installer: the app shows one line to paste on a fresh server,
#   curl -fsSL https://link.dusk.bot/i/<token> | sh
# and this script installs everything, reports each step to the app through the link service, and links the server.
# safe to run again: every step checks what is already there, and a server that is already linked is only repaired.
# the link service bakes __LINK_BASE__ and __LINK_TOKEN__ in when it serves /i/<token>; run from a file it takes
# the token as $1 and LINK_BASE from the environment.
# knobs (env): LINK_BASE; DUSK_PACKAGE (an npm spec or tarball url: installs that instead of the build the link service
# serves, only when set); BOT_DESKTOP_IMAGE; NO_COLOR, DUSK_ASCII=1, DUSK_PLAIN=1, DUSK_NO_ANIM=1, DUSK_VERBOSE=1 (terminal);
# DUSK_INSTALL_DEMO=1 (or =fail) plays the whole screen with pretend steps and changes nothing, no root needed.
set -eu

PLACEHOLDER_BASE="__LINK""_BASE__"
PLACEHOLDER_TOKEN="__LINK""_TOKEN__"
BAKED_BASE="__LINK_BASE__"
BAKED_TOKEN="__LINK_TOKEN__"

if [ -z "${LINK_BASE:-}" ]; then
  if [ "$BAKED_BASE" = "$PLACEHOLDER_BASE" ]; then LINK_BASE="https://link.dusk.bot"; else LINK_BASE="$BAKED_BASE"; fi
fi
LINK_BASE=${LINK_BASE%/}
# the token, root-run code and the server build come from here: https only (plain http just for a loopback test service)
case "$LINK_BASE" in
  https://*) PROTO="=https" ;;
  http://127.0.0.1|http://127.0.0.1:*|http://localhost|http://localhost:*) PROTO="=http,https" ;;
  *) printf 'LINK_BASE must be an https:// address.\n' >&2; exit 1 ;;
esac
if [ "$BAKED_TOKEN" = "$PLACEHOLDER_TOKEN" ]; then TOKEN="${1:-}"; else TOKEN="$BAKED_TOKEN"; fi

DUSK_PACKAGE="${DUSK_PACKAGE:-}"
# the bot computer: the link service names the image (BOT_DESKTOP_IMAGE in shared/bot-desktop.ts) and hands out
# deploy/bot-desktop/ as a kit; the image is pulled when a registry copy exists, else built here. the env wins.
BOT_DESKTOP_IMAGE="${BOT_DESKTOP_IMAGE:-}"
KIT_DIR=/opt/duskbot-link/bot-desktop
DEMO="${DUSK_INSTALL_DEMO:-}"
[ "$DEMO" = 0 ] && DEMO=""

SVC_USER=dusk
SVC_HOME=/home/dusk
# names from before the rename (the app's own copy is electron/legacy-names.mjs). a server set up then keeps its
# server account; its folders, units and profiles move to the new names (migrate_legacy) the next time this runs.
OLD=openmausbot
OLD_SVC_USER=maus
if ! id "$SVC_USER" >/dev/null 2>&1 && id "$OLD_SVC_USER" >/dev/null 2>&1; then SVC_USER=$OLD_SVC_USER SVC_HOME=/home/$OLD_SVC_USER; fi
OLD_UNITS="$OLD-link.service $OLD.service $OLD-engines.path $OLD-handoff.service $OLD-restart.service"
DATA=$SVC_HOME/.duskbot
# accounts: the server runs as $SVC_USER and never holds docker, the link agent as omb-link (tunnel.json and the app's ssh key
# are its own), docker only through the gate as omb-docker; every bot's turn runs in the bot box (DUSK_BOT_BOX=required)
LINK_USER=omb-link
LINK_HOME=/var/lib/omb-link
HANDOFF=$LINK_HOME/handoff
GATE_USER=omb-docker
GATE_GROUP=omb-dockergate
GATE_SOCK=/run/duskbot-docker/docker.sock
LIB=/usr/local/lib/duskbot
GATE=$LIB/docker-gate.mjs
ETC=/etc/duskbot
CLAUDE_TOKEN_LINE='^CLAUDE_CODE_OAUTH_TOKEN=[A-Za-z0-9._~+/=-]{20,}$'
STATE=/var/lib/duskbot-link
LOGS=/var/log/duskbot-link
LOGS_SHOWN=$LOGS
# what this script added that was not here before (packages, apt sources, config it replaced), one line each, so
# uninstall.sh puts back exactly that. kept apart from $STATE: a plain uninstall leaves it for a later --all.
MANIFEST=/var/lib/duskbot/install-manifest
AGENT=/opt/duskbot-link/agent.mjs
PORT=8799
UNITS=/etc/systemd/system
CADDY_SITE=/etc/caddy/duskbot.caddy
CADDY_MAIN=/etc/caddy/Caddyfile
OLD_STATE=/var/lib/$OLD-link OLD_LOGS=/var/log/$OLD-link OLD_MANIFEST=/var/lib/$OLD/install-manifest OLD_AGENT_DIR=/opt/$OLD-link
OLD_LIB=/usr/local/lib/$OLD OLD_ETC=/etc/$OLD OLD_BWRAP_PROFILE=/etc/apparmor.d/$OLD-bwrap OLD_CADDY_SITE=/etc/caddy/$OLD.caddy
export DEBIAN_FRONTEND=noninteractive

say() { printf '%s\n' "$*"; }
fail_line() { printf '\n%s\n' "$*" >&2; }

# ---------- terminal ----------
# tty: spinner, checklist, colors (if allowed). plain: one line per step, no escapes (pipes, logs, TERM=dumb).
ESC=$(printf '\033')
UI=plain DEPTH=0 ASCII=1 COLS=80 ROWS=24 LIST=0 MS=1 TICK=0.12 MASCOT=0 MASCOT_COL=61 TICKS=0
R="" BOLD="" DIM="" OK="" ACC="" WARN="" ERR="" SHADOW="" FAINT="" EL=""
ui_init() {
  if [ -t 1 ] && [ "${TERM:-dumb}" != dumb ] && [ "${DUSK_PLAIN:-}" != 1 ]; then UI="tty"; fi
  size=$( { stty size </dev/tty; } 2>/dev/null || true)
  case "$size" in
    [0-9]*' '[0-9]*) ROWS=${size% *}; COLS=${size#* } ;;
    *) case "${COLUMNS:-}" in [0-9]*) COLS=$COLUMNS ;; esac ;;
  esac
  [ "$COLS" -ge 20 ] 2>/dev/null || COLS=80
  case "$(date +%s%N 2>/dev/null)" in *N*|'') MS=0 ;; esac
  [ "$UI" = tty ] || return 0
  ASCII=0
  [ "${DUSK_ASCII:-}" = 1 ] && ASCII=1
  EL="${ESC}[K"
  if [ -z "${NO_COLOR:-}" ]; then
    case "${COLORTERM:-}" in
      truecolor|24bit) DEPTH=24 ;;
      *) case "${TERM:-}" in *256col*|xterm-kitty|*ghostty*|wezterm|alacritty|tmux*) DEPTH=8 ;; *) DEPTH=4 ;; esac ;;
    esac
  fi
  [ "$DEPTH" -gt 0 ] || return 0
  R="${ESC}[0m" BOLD="${ESC}[1m"
  case "$DEPTH" in
    24) DIM="${ESC}[38;2;118;128;140m" OK="${ESC}[38;2;46;230;140m" ACC="${ESC}[38;2;0;214;250m" WARN="${ESC}[38;2;250;190;70m"
        ERR="${ESC}[38;2;255;92;92m" SHADOW="${ESC}[38;2;58;72;98m" FAINT="${ESC}[38;2;86;98;116m" ;;
    8) DIM="${ESC}[38;5;245m" OK="${ESC}[38;5;42m" ACC="${ESC}[38;5;45m" WARN="${ESC}[38;5;214m" ERR="${ESC}[38;5;203m"
       SHADOW="${ESC}[38;5;238m" FAINT="${ESC}[38;5;241m" ;;
    *) DIM="${ESC}[90m" OK="${ESC}[32m" ACC="${ESC}[36m" WARN="${ESC}[33m" ERR="${ESC}[31m" SHADOW="${ESC}[90m" FAINT="${ESC}[90m" ;;
  esac
}

now_ms() {
  if [ "$MS" = 1 ]; then _t=$(date +%s%N); printf '%s' "${_t%??????}"; else printf '%s000' "$(date +%s)"; fi
}
fmt_ms() { # milliseconds -> 0.4s, 12s, 3m 07s
  if [ "$1" -lt 10000 ] && [ "$MS" = 1 ]; then printf '%d.%ds' $(($1 / 1000)) $(($1 % 1000 / 100))
  elif [ "$1" -lt 60000 ]; then printf '%ds' $(($1 / 1000))
  else printf '%dm %02ds' $(($1 / 60000)) $(($1 % 60000 / 1000)); fi
}
fmt_mb() { _t=$(($1 * 10 / 1048576)); printf '%d.%d' $((_t / 10)) $((_t % 10)); }

glyph() { # name -> G
  if [ "$ASCII" = 1 ]; then
    case "$1" in ok) G="+" ;; sep) G="-" ;; fail) G="x" ;; skip) G="o" ;; wait) G="." ;; fill) G="#" ;; rest) G="-" ;; arrow) G=">" ;; bar) G="|" ;; esac
  else
    case "$1" in ok) G="✔" ;; sep) G="·" ;; fail) G="✖" ;; skip) G="○" ;; wait) G="·" ;; fill) G="█" ;; rest) G="░" ;; arrow) G="→" ;; bar) G="│" ;; esac
  fi
}
spin_frame() { # tick -> G (braille dots, see third_party/cli-spinners)
  if [ "$ASCII" = 1 ]; then
    case $(($1 % 4)) in 0) G="|" ;; 1) G="/" ;; 2) G="-" ;; *) G="\\" ;; esac
    return 0
  fi
  case $(($1 % 10)) in
    0) G="⠋" ;; 1) G="⠙" ;; 2) G="⠹" ;; 3) G="⠸" ;; 4) G="⠼" ;; 5) G="⠴" ;; 6) G="⠦" ;; 7) G="⠧" ;; 8) G="⠇" ;; *) G="⠏" ;;
  esac
}

# the wordmark: an ascii template (# full block, p upper half, b lower half) drawn with a diagonal gradient and a
# one-cell drop shadow. original art, no font file.
banner_art() {
  cat <<'EOF'
##b   b##   b####b   ##    ##   b######  ######b    b####b   ########
###b b###  ##    ##  ##    ##  ##        ##    ##  ##    ##     ##
## p#p ##  ########  ##    ##   p####b   #######   ##    ##     ##
##     ##  ##    ##  ##    ##        ##  ##    ##  ##    ##     ##
##     ##  ##    ##   p####p   ######p   ######p    p####p      ##
EOF
}
# the intro: the block letters decode out of noise, a light sweeps across once, then they stay. about a second,
# one awk process, frames drawn in place (cursor up, overwrite). static when there is no color to animate.
banner() {
  say ""
  if [ "$UI" != tty ] || [ "$ASCII" = 1 ] || [ "$COLS" -lt 80 ]; then
    say "  ${ACC}${BOLD}open${R}${BOLD}dusk${R}  ${DIM}server setup${R}"
    say ""
    MASCOT=0
    return 0
  fi
  anim=0; [ "$DEPTH" -ge 8 ] && [ "${DUSK_NO_ANIM:-}" != 1 ] && anim=1
  say "  ${DIM}o p e n${R}"
  banner_art | awk -v depth="$DEPTH" -v esc="$ESC" -v shade="$SHADOW" -v reset="$R" -v anim="$anim" -v seed="$$" '
    function lerp(a, b, t) { return int(a + (b - a) * t + 0.5) }
    function code(r, g, b) {
      if (depth == 24) return esc "[38;2;" r ";" g ";" b "m"
      if (depth == 8) return esc "[38;5;" (16 + 36 * int(r / 51 + 0.5) + 6 * int(g / 51 + 0.5) + int(b / 51 + 0.5)) "m"
      if (depth == 4) return esc "[1;36m"
      return ""
    }
    # the gradient at a cell; light 0..1 mixes it toward white, dark scales it down
    function paint(x, y, light, dark,   t, s, r, g, b) {
      t = (x + y * 3) / (w + rows * 3)
      if (t < 0.5) { s = t * 2; r = lerp(40, 0, s); g = lerp(255, 200, s); b = lerp(150, 255, s) }
      else { s = (t - 0.5) * 2; r = lerp(0, 190, s); g = lerp(200, 110, s); b = lerp(255, 255, s) }
      if (light > 0) { r = lerp(r, 255, light); g = lerp(g, 255, light); b = lerp(b, 255, light) }
      if (dark > 0) { r = int(r * dark); g = int(g * dark); b = int(b * dark) }
      return code(r, g, b)
    }
    function frame(f,   y, x, c, p, k, out, last, glyph, d, center) {
      if (f > 0) printf "%s[%dA", esc, rows
      center = (f - D) / (S - 1) * (w + 24) - 12
      for (y = 1; y <= rows; y++) {
        out = "\r  "; last = ""
        for (x = 1; x <= w + 1; x++) {
          c = (y <= NR) ? substr(art[y], x, 1) : " "
          p = (y > 1 && x > 1) ? substr(art[y - 1], x - 1, 1) : " "
          if (c == "#" || c == "p" || c == "b") {
            glyph = (c == "#" ? "█" : (c == "p" ? "▀" : "▄"))
            if (f < D && key[y, x] > (f + 1) / D * 1.35 - x / w * 0.35) { k = paint(x, y, 0, 0.35 + rand() * 0.3); glyph = noise[int(rand() * 6)] }
            else if (f >= D && f < D + S) { d = x + y * 2 - center; if (d < 0) d = -d; k = paint(x, y, d < 4 ? (1 - d / 4) * 0.85 : 0, 0) }
            else k = paint(x, y, 0, 0)
            if (k != last) { out = out k; last = k }
            out = out glyph
          } else if (p == "#" && f >= D - 2) {
            if (last != shade) { out = out shade; last = shade }
            out = out "░"
          } else out = out " "
        }
        sub(/ +$/, "", out)
        printf "%s%s%s[K\n", out, (last != "" ? reset : ""), esc
      }
      fflush()
    }
    { art[NR] = $0; if (length($0) > w) w = length($0) }
    END {
      rows = NR + 1; D = 9; S = 9
      split("░ ▒ ▓ ▚ ▞ ▙", n, " "); for (i = 0; i < 6; i++) noise[i] = n[i + 1]
      srand(seed)
      for (y = 1; y <= rows; y++) for (x = 1; x <= w + 1; x++) key[y, x] = rand()
      if (!anim) { frame(D + S); exit }
      for (f = 0; f <= D + S; f++) { frame(f); if (f < D + S) system("sleep 0.05") }
    }'
  say ""
  # the mascot sits at column MASCOT_COL of this line; watch_step wags its tail while work runs
  printf '  %s%-58s%s%s<:3 )~%s\n' "$DIM" "your own team of AI bots, on your own server" "$R" "$ACC" "$R"
  MASCOT_COL=61 MASCOT=1
  [ "$DEPTH" -gt 0 ] || MASCOT=0
  say ""
}

# the mascot while a step runs: tail wags, now and then a blink. drawn in place a few lines up, only when the whole
# screen is known to fit (LIST mode), so the cursor never lands anywhere else.
BELOW_TAG=3
mascot() { # tick
  [ "$MASCOT" = 1 ] && [ "$LIST" = 1 ] || return 0
  case $(($1 / 4 % 10)) in
    1|7) _m="<:3 )-" ;; 3) _m="<:3 )_" ;; 5) _m="<.3 )~" ;; 9) _m="<:3 )-" ;; *) _m="<:3 )~" ;;
  esac
  _up=$((BELOW_TAG + 1 + PH_IDX))
  printf '%s[%dA%s[%dG%s%s%s%s[%dB\r' "$ESC" "$_up" "$ESC" "$MASCOT_COL" "$ACC" "$_m" "$R" "$ESC" "$_up"
}

# one step line: "  ✔ Title            1.2s  extra"; the title column is TW wide, the time column 6
TW=32
draw() { # glyph-color glyph time extra
  printf '\r  %s%s%s %s %s%6s%s  %s%s' "$1" "$2" "$R" "$TPAD" "$DIM" "$3" "$R" "$4" "$EL"
}
pending_line() { glyph wait; printf '\r  %s%s %s%s%s\n' "$DIM" "$G" "$(phase_title "$1")" "$R" "$EL"; }

progress_text() { # done total unit -> X (bar, percent, amounts), sized to what is left of the line
  _avail=$((COLS - TW - 15 - ${#SUBTXT} - 2))
  if [ "${2:-0}" -le 0 ] 2>/dev/null; then
    [ "$3" = MB ] && X="${DIM}$(fmt_mb "$1") MB${R}" || X="${DIM}$1 $3${R}"
    return 0
  fi
  _d=$1; [ "$_d" -gt "$2" ] && _d=$2
  _pct=$((_d * 100 / $2))
  if [ "$3" = MB ]; then _amt="$(fmt_mb "$_d")/$(fmt_mb "$2") MB"; else _amt="$_d/$2 $3"; fi
  _bw=$((_avail - ${#_amt} - 7)); [ "$_bw" -gt 28 ] && _bw=28
  X=""
  if [ "$_bw" -ge 6 ]; then
    _f=$((_d * _bw / $2)) _k=0 _on="" _off=""
    glyph fill; _gf=$G; glyph rest
    while [ "$_k" -lt "$_bw" ]; do
      if [ "$_k" -lt "$_f" ]; then _on="$_on$_gf"; else _off="$_off$G"; fi
      _k=$((_k + 1))
    done
    X="${ACC}${_on}${SHADOW}${_off}${R} "
  fi
  X=$(printf '%s%3d%%  %s%s%s' "$X" "$_pct" "$DIM" "$_amt" "$R")
}

# draws the spinner line until the step's process ends. the step tells it about downloads through $PROGRESS:
#   file <path> <total bytes>   bytes <done> <total>   count <done> <total> <unit>
spin_color() { # tick -> SC: mint, cyan, violet and back, a slow drift
  case "$DEPTH" in
    24) case $(($1 / 2 % 6)) in 0) SC="${ESC}[38;2;40;255;150m" ;; 1|5) SC="${ESC}[38;2;0;230;210m" ;; 2|4) SC="${ESC}[38;2;0;200;255m" ;; *) SC="${ESC}[38;2;170;120;255m" ;; esac ;;
    8) case $(($1 / 2 % 6)) in 0) SC="${ESC}[38;5;48m" ;; 1|5) SC="${ESC}[38;5;44m" ;; 2|4) SC="${ESC}[38;5;45m" ;; *) SC="${ESC}[38;5;141m" ;; esac ;;
    *) SC=$ACC ;;
  esac
}
watch_step() {
  _i=${TICKS:-0} _tail=""
  _tw=$((COLS - TW - 16 - ${#SUBTXT} - 2))
  while [ ! -f "$TMP/rc" ]; do
    [ ! -f "$TMP/cancelled" ] || on_stop
    _el=$(fmt_ms $(($(now_ms) - PH_T0)))
    X=""
    if [ -f "$PROGRESS" ] && read -r _kind _a _b _c 2>/dev/null <"$PROGRESS"; then
      case "$_kind" in
        file) _cur=$(wc -c 2>/dev/null <"$_a" | tr -cd 0-9); progress_text "${_cur:-0}" "$_b" MB ;;
        bytes) progress_text "$_a" "$_b" MB ;;
        count) progress_text "$_a" "$_b" "${_c:-}" ;;
      esac
    elif [ "$_tw" -gt 10 ]; then
      [ $((_i % 3)) -eq 0 ] && _tail=$(tail -n 1 "$LOG" 2>/dev/null | tr -cd '\40-\176' | cut -c1-"$_tw")
      X="${FAINT}${_tail}${R}"
    fi
    [ $((_i % 4)) -eq 3 ] && stream_lines
    spin_frame "$_i"
    spin_color "$_i"
    [ $((_i % 4)) -eq 0 ] && mascot "$_i"
    draw "$SC" "$G" "$_el" "$SUB$X"
    _i=$((_i + 1))
    sleep "$TICK"
  done
  TICKS=$_i
}

# ---------- root ----------
become_root() {
  [ "$(id -u)" -eq 0 ] && return 0
  if ! command -v sudo >/dev/null 2>&1; then
    fail_line "Please run this as root (or install sudo), then paste the line again."
    exit 1
  fi
  say "Asking for administrator rights..."
  if [ -r "$0" ] && [ "${0##*/}" != "sh" ] && [ "${0##*/}" != "dash" ]; then
    exec sudo env LINK_BASE="$LINK_BASE" DUSK_PACKAGE="$DUSK_PACKAGE" BOT_DESKTOP_IMAGE="$BOT_DESKTOP_IMAGE" \
      COLORTERM="${COLORTERM:-}" NO_COLOR="${NO_COLOR:-}" DUSK_ASCII="${DUSK_ASCII:-}" DUSK_PLAIN="${DUSK_PLAIN:-}" DUSK_NO_ANIM="${DUSK_NO_ANIM:-}" DUSK_VERBOSE="${DUSK_VERBOSE:-}" sh "$0" "$TOKEN"
  fi
  # piped: the script is gone from stdin, so fetch it again for root
  curl -fsSL --proto "$PROTO" --proto-redir "$PROTO" --retry 3 "$LINK_BASE/i" | sudo env LINK_BASE="$LINK_BASE" DUSK_PACKAGE="$DUSK_PACKAGE" BOT_DESKTOP_IMAGE="$BOT_DESKTOP_IMAGE" \
    COLORTERM="${COLORTERM:-}" NO_COLOR="${NO_COLOR:-}" DUSK_ASCII="${DUSK_ASCII:-}" DUSK_PLAIN="${DUSK_PLAIN:-}" DUSK_NO_ANIM="${DUSK_NO_ANIM:-}" DUSK_VERBOSE="${DUSK_VERBOSE:-}" sh -s "$TOKEN"
  exit $?
}

# ---------- helpers ----------
# every command worth seeing goes into the step's log as "$ command", which the app's terminal mirror shows
show() { printf '$ %s\n' "$*" | redact; }
x() { show "$@"; "$@"; }
retry() {
  n=1
  if [ "$1" = as_user ]; then shift; show "$@"; set -- as_user "$@"; else show "$@"; fi
  while :; do
    if "$@"; then return 0; fi
    [ "$n" -ge 3 ] && return 1
    printf 'attempt %s/3 failed; retrying in %s seconds\n' "$n" "$((n * 5))"
    sleep $((n * 5))
    n=$((n + 1))
  done
}

manifest_add() { # line
  [ -n "$DEMO" ] && return 0
  install -d -m 0755 "${MANIFEST%/*}"
  grep -qxF "$1" "$MANIFEST" 2>/dev/null || printf '%s\n' "$1" >> "$MANIFEST"
}
# a file this script creates, recorded only when it was not there before
new_file() { [ -e "$1" ] || manifest_add "file $1"; }
installed_pkgs() { dpkg-query -W -f '${db:Status-Abbrev} ${Package}\n' 2>/dev/null | awk '$1 ~ /^ii/ { print $2 }' | sort -u; }
# apt-get install, recording every package it added (dependencies too) in the manifest
apt_get_install() { # args...
  installed_pkgs > "$TMP/pkgs.before"
  if retry apt-get -y -q -o DPkg::Lock::Timeout=300 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold install "$@"; then _rc=0; else _rc=1; fi
  installed_pkgs | comm -13 "$TMP/pkgs.before" - | while read -r _p; do manifest_add "pkg $_p"; done
  return "$_rc"
}

apt_update() {
  [ -f "$TMP/apt-updated" ] && return 0
  retry apt-get -q -o DPkg::Lock::Timeout=300 update && : > "$TMP/apt-updated"
}
apt_install() {
  missing=""
  for pkg in "$@"; do dpkg -s "$pkg" >/dev/null 2>&1 || missing="$missing $pkg"; done
  [ -z "$missing" ] && return 0
  apt_update
  # shellcheck disable=SC2086
  apt_get_install --no-install-recommends $missing
}
fetch() { retry curl -fsSL --proto "$PROTO" --proto-redir "$PROTO" --connect-timeout 15 -m 300 "$1" -o "$2"; }

as_user() { runuser -u "$SVC_USER" -- env HOME="$SVC_HOME" PATH="$SVC_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" "$@"; }

state_get() { [ -f "$STATE/$1" ] && cat "$STATE/$1" || true; }
state_set() { printf '%s\n' "$2" > "$STATE/$1.tmp" && mv "$STATE/$1.tmp" "$STATE/$1"; }
progress() { rm -f "$PROGRESS.json"; printf '%s\n' "$*" > "$PROGRESS.tmp" && mv "$PROGRESS.tmp" "$PROGRESS"; }

# no bearer token, link secret or api key ever leaves this script: not into a log, not to the app
redact() {
  if [ -n "${VPS_TOKEN:-}" ]; then set -- -e "s/$VPS_TOKEN/[redacted]/g" -e "s/$SECRET/[redacted]/g"; else set --; fi
  sed -e 's/[Bb]earer [A-Za-z0-9._~+\/=-]*/Bearer [redacted]/g' \
    -e 's/sk-ant-[A-Za-z0-9_-]*/sk-ant-[redacted]/g' -e 's/sk-[A-Za-z0-9_-]\{20,\}/sk-[redacted]/g' \
    -e 's/\([Tt][Oo][Kk][Ee][Nn]["=: ]\{1,3\}\)[^ "&,]*/\1[redacted]/g' \
    -e 's/\([Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]["=: ]\{1,3\}\)[^ "&,]*/\1[redacted]/g' \
    -e 's/\([Ss][Ee][Cc][Rr][Ee][Tt]["=: ]\{1,3\}\)[^ "&,]*/\1[redacted]/g' \
    -e 's/\(_KEY["=: ]\{1,3\}\)[^ "&,]*/\1[redacted]/g' "$@"
}
json_lines() { # stdin lines -> the inside of a json string array
  tr -d '\000-\010\013\014\016-\037\177' | tr '\t' ' ' | cut -c1-300 | redact \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk '{ printf "%s\"%s\"", (NR > 1 ? "," : ""), $0 }'
}
json_escape_file() {
  # last lines of a log as one json string body: no control characters, quotes and backslashes escaped
  tail -n 30 "$1" 2>/dev/null | tail -c 3500 | tr -d '\000-\010\013\014\016-\037' | tr '\t' ' ' | redact \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk '{ printf "%s\\n", $0 }'
}
app_step() { case "$1" in sandbox|fence) echo desktop ;; *) echo "$1" ;; esac; }

# the step's new log lines (and the command they belong to) to the app every ~0.5 s while it runs: at most 40 lines
# a batch, older ones skipped, one batch in flight at a time. "final" waits for it, so nothing lands after "done".
SENT=0 CMD="" STEP_T0=0 LAST_ACTIVITY=0 LAST_SIGNATURE="" LAST_POST=0
progress_snapshot() {
  _progress="" _progress_sig=""
  if [ -f "$PROGRESS.json" ]; then
    _progress=$(cat "$PROGRESS.json")
    _progress_sig=$_progress
  elif [ -f "$PROGRESS" ] && read -r _kind _a _b _c < "$PROGRESS"; then
    case "$_kind" in
      file)
        _a=$( { wc -c < "$_a"; } 2>/dev/null | tr -cd 0-9)
        _a=${_a:-0}
        case "$_a:$_b" in *[!0-9:]*|:*|*:) ;; *)
          _progress="{\"kind\":\"download\",\"receivedBytes\":$_a${_b:+,\"totalBytes\":$_b}}" ;;
        esac ;;
      bytes)
        case "$_a:$_b" in *[!0-9:]*|:*|*:) ;; *) _progress="{\"kind\":\"download\",\"receivedBytes\":$_a,\"totalBytes\":$_b}" ;; esac ;;
      count)
        case "$_a:$_b" in *[!0-9:]*|:*|*:) ;; *)
          case "$_c" in layers) _kind=layers ;; steps) _kind=build ;; *) _kind="" ;; esac
          [ -z "$_kind" ] || _progress="{\"kind\":\"$_kind\",\"completed\":$_a,\"total\":$_b}" ;;
        esac ;;
    esac
    _progress_sig=$_progress
  fi
  _size=$( { wc -c < "$LOG"; } 2>/dev/null | tr -cd 0-9)
  _signature="${_size:-0}|$_progress_sig"
  _now=$(now_ms)
  _heartbeat=true
  if [ "$_signature" != "$LAST_SIGNATURE" ]; then LAST_ACTIVITY=$_now; LAST_SIGNATURE=$_signature; _heartbeat=false; fi
  _elapsed=$((_now - STEP_T0)) _quiet=$((_now - LAST_ACTIVITY))
  [ "$_elapsed" -ge 0 ] || _elapsed=0
  [ "$_quiet" -ge 0 ] || _quiet=0
  [ "$_quiet" -le "$_elapsed" ] || _quiet=$_elapsed
}

post_event() {
  _answer=$(curl -sS --proto "$PROTO" --proto-redir "$PROTO" --connect-timeout 2 -m 5 -w '\n%{http_code}' -X POST -H "authorization: Bearer $VPS_TOKEN" -H "content-type: application/json" \
    --data "$1" "$LINK_BASE/v1/sessions/$LINK_ID/events" 2>/dev/null) || return 1
  case "$_answer" in
    *'"code":"cancelled"'*) : > "$TMP/cancelled" ;;
  esac
  [ "${_answer##*
}" = 200 ]
}

stream_lines() { # [final]
  [ "$OFFLINE" = 1 ] || [ -n "$DEMO" ] && return 0
  progress_snapshot
  if [ "${1:-}" = final ]; then _w=0; while [ -f "$TMP/posting" ] && [ "$_w" -lt 50 ]; do sleep 0.1; _w=$((_w + 1)); done
  elif [ -f "$TMP/posting" ]; then return 0; fi
  _n=$(wc -l 2>/dev/null <"$LOG" | tr -cd 0-9); _n=${_n:-0}
  if [ "$_n" -le "$SENT" ] && [ "$_heartbeat" = true ] && [ $((_now - LAST_POST)) -lt 2000 ]; then return 0; fi
  _from=$((SENT + 1)) _skip=""
  if [ $((_n - SENT)) -gt 40 ]; then _from=$((_n - 39)); _skip="[$((_n - SENT - 40)) more lines]"; fi
  _batch=""
  [ "$_n" -le "$SENT" ] || _batch=$(sed -n "${_from},${_n}p" "$LOG")
  _c=$(printf '%s\n' "$_batch" | sed -n 's/^\$ //p' | tail -n 1 | cut -c1-200)
  [ -n "$_c" ] && CMD=$_c
  _lines=$( { [ -n "$_skip" ] && printf '%s\n' "$_skip"; [ -z "$_batch" ] || printf '%s\n' "$_batch"; } | json_lines)
  SENT=$_n
  LAST_POST=$_now
  _cmd=$(printf '%s\n' "$CMD" | json_lines)
  _body="{\"step\":\"$(app_step "$STEP_ID")\",\"status\":\"running\",${CMD:+\"cmd\":$_cmd,}\"lines\":[$_lines],\"activity\":{\"elapsedMs\":$_elapsed,\"quietMs\":$_quiet},\"heartbeat\":$_heartbeat${_progress:+,\"progress\":$_progress}}"
  : > "$TMP/posting"
  ( post_event "$_body" || true; rm -f "$TMP/posting" ) &
  if [ "${1:-}" = final ]; then wait $!; fi
  return 0
}

OFFLINE=0 REPAIR=0
report() { # step status [logfile]
  [ "$OFFLINE" = 1 ] && return 0
  [ -n "$DEMO" ] && return 0
  # the app knows one "desktop" step; sandbox and fence are its first parts, so they only say it is running
  case "$1" in sandbox|fence) [ "$2" = running ] || return 0; set -- desktop running ;; esac
  if [ -n "${3:-}" ]; then
    body="{\"step\":\"$1\",\"status\":\"$2\",\"log\":\"$(json_escape_file "$3")\"}"
  else
    body="{\"step\":\"$1\",\"status\":\"$2\"}"
  fi
  post_event "$body" || true
}

# plain words for a failed step, printed once in the terminal
failure_words() {
  case "$1" in
    check) say "This server can't run Dusk Bot: it needs Ubuntu or Debian on a 64-bit processor with systemd." ;;
    basics) say "Couldn't install the basic tools. Check this server's internet connection and paste the line again." ;;
    user) say "Couldn't create the account your bots run under." ;;
    node) say "Couldn't install Node. Check this server's internet connection and paste the line again." ;;
    app) say "Couldn't install Dusk Bot. Paste the line again; it picks up where it stopped." ;;
    engines) say "Couldn't install the Claude and ChatGPT tools. Paste the line again; it picks up where it stopped." ;;
    service) say "Dusk Bot didn't start. The app shows the last lines of its log." ;;
    address) say "Couldn't set up this server's address. Paste the line again." ;;
    desktop|sandbox|fence) say "Couldn't get the bot computer ready." ;;
    link) say "Couldn't link this server to your app. Make a new line in the app and paste it here." ;;
    *) say "Something went wrong. Paste the line again; it picks up where it stopped." ;;
  esac
}

step_title() {
  case "$1" in
    check) say "Checking your server" ;;
    basics) say "Getting the basics" ;;
    docker) say "Installing Docker" ;;
    user) say "Making a home for your bots" ;;
    node) say "Installing Node" ;;
    app) say "Installing Dusk Bot" ;;
    engines) say "Installing Claude and ChatGPT" ;;
    service) say "Starting Dusk Bot" ;;
    address) say "Setting up the connection" ;;
    sandbox) say "Sandboxing bot computers" ;;
    fence) say "Fencing their network" ;;
    desktop) say "Building the bot computer" ;;
    link) say "Pairing with your app" ;;
  esac
}

# the screen shows five phases, one line each: the running step is its sub-status, and the line becomes one check
# when the phase is done. the steps themselves stay in the logs (and in what the app sees).
PHASES="prepare runtime omb computer link"
phase_title() {
  case "$1" in
    prepare) say "Preparing your server" ;;
    runtime) say "Installing the runtime" ;;
    omb) say "Installing Dusk Bot" ;;
    computer) say "Setting up the bot computer" ;;
    link) say "Linking to your app" ;;
  esac
}
phases_after() { _seen=0; for _s in $PHASES; do [ "$_seen" = 1 ] && printf '%s ' "$_s"; [ "$_s" = "$1" ] && _seen=1; done; return 0; }

checklist() {
  [ "$UI" = tty ] || return 0
  # rows permitting (banner and all), the phases are drawn up front and each turns into a check in place;
  # otherwise they appear one by one
  [ "$ROWS" -ge 26 ] || return 0
  LIST=1
  for _s in $PHASES; do pending_line "$_s"; done
  printf '%s[%dA' "$ESC" 5
}

PH_ID="" PH_IDX=0 PH_NOTE="" PH_WARN=""
phase() { # id
  PH_ID=$1 PH_NOTE="" PH_WARN="" PH_T0=$(now_ms)
  TPAD=$(printf "%-${TW}s" "$(phase_title "$1")")
  [ "$UI" = tty ] || printf '  %-34s' "$(phase_title "$1")..."
}
phase_end() {
  took=$(fmt_ms $(($(now_ms) - PH_T0)))
  if [ "$UI" = tty ]; then
    if [ -n "$PH_WARN" ]; then glyph skip; draw "$WARN" "$G" "$took" "${WARN}${PH_WARN}${R}"
    else glyph ok; draw "$OK" "$G" "$took" "${DIM}${PH_NOTE}${R}"; fi
    printf '\n'
  else
    say "done ($took)${PH_WARN:+, $PH_WARN}${PH_NOTE:+, $PH_NOTE}"
  fi
  PH_IDX=$((PH_IDX + 1))
}

STEP_PID="" SOFT_FAILED=""
step() { # id function
  [ ! -f "$TMP/cancelled" ] || on_stop
  LOG="$LOGS/$1.log"
  title=$(step_title "$1")
  SUBTXT=$title SUB="${DIM}${title}${R}  "
  : > "$LOG"
  rm -f "$PROGRESS" "$PROGRESS.json"
  STEP_ID=$1 SENT=0 CMD="" STEP_T0=$(now_ms) LAST_SIGNATURE="" LAST_POST=0
  LAST_ACTIVITY=$STEP_T0
  report "$1" running &
  rpid=$!
  set +e
  rm -f "$TMP/rc"
  # the step runs in the background and leaves its exit code in $TMP/rc; the spinner draws until it appears
  if [ -n "$DEMO" ]; then run=demo_work; else run=$2; fi
  ( ( set -e; "$run" "$1" ) </dev/null >>"$LOG" 2>&1; echo $? > "$TMP/rc" ) &
  STEP_PID=$!
  if [ "$UI" = tty ]; then watch_step; else
    while [ ! -f "$TMP/rc" ]; do [ ! -f "$TMP/cancelled" ] || on_stop; sleep 0.5; stream_lines; done
  fi
  wait "$STEP_PID"
  [ ! -f "$TMP/cancelled" ] || on_stop
  code=$(cat "$TMP/rc" 2>/dev/null)
  # the bot computer is optional: any failure in its parts is a soft one
  case "$1" in sandbox|fence|desktop) case "$code" in 0|10) ;; *) code=11 ;; esac ;; esac
  STEP_PID=""
  wait "$rpid" 2>/dev/null
  stream_lines final
  [ ! -f "$TMP/cancelled" ] || on_stop
  set -e
  took=$(fmt_ms $(($(now_ms) - PH_T0)))
  why=$(tail -n 1 "$LOG" 2>/dev/null | tr -cd '\40-\176' | cut -c1-$((COLS - TW - 16)))
  case "$code" in
    0)
      report "$1" "done"; state_set "step-$1" "done"
      if [ "$1" = desktop ]; then
        case "$(state_get desktop)" in built) PH_NOTE="built here" ;; pulled) PH_NOTE="pulled" ;; *) PH_NOTE="ready" ;; esac
      fi ;;
    10)
      report "$1" skipped "$LOG"; state_set "step-$1" skipped
      # the first skip in a phase is worth a dim word on its line
      [ -n "$PH_NOTE" ] || PH_NOTE=$why ;;
    11)
      # optional part failed: say so in amber on the phase line, keep going (bots work without a bot computer)
      report "$1" skipped "$LOG"; state_set "step-$1" failed
      [ -n "$PH_WARN" ] || PH_WARN=$why
      SOFT_FAILED="$SOFT_FAILED $1" ;;
    *)
      if [ "$UI" = tty ]; then glyph fail; draw "$ERR" "$G" "$took" "${ERR}${title} failed${R}"; mascot 0; printf '\n'; else say "failed ($took)"; fi
      report "$1" failed "$LOG"
      if [ "$LIST" = 1 ]; then for _s in $(phases_after "$PH_ID"); do pending_line "$_s"; done; fi
      failure_panel "$1"
      exit 1 ;;
  esac
}

failure_panel() { # id
  glyph bar; _bar=$G
  printf '\n  %s%s%s couldn'"'"'t finish%s\n\n' "$ERR$BOLD" "$(step_title "$1")" "$R$ERR" "$R"
  tail -n 8 "$LOG" 2>/dev/null | tr -cd '\12\40-\176' | cut -c1-$((COLS - 8)) | while IFS= read -r line; do
    printf '    %s%s%s %s\n' "$SHADOW" "$_bar" "$R" "$line"
  done
  glyph arrow
  _hint=$(failure_words "$1" | fold -s -w $((COLS - 6)))
  _first=1
  printf '\n'
  printf '%s\n' "$_hint" | while IFS= read -r line; do
    if [ "$_first" = 1 ]; then printf '  %s%s%s %s\n' "$ACC" "$G" "$R" "$line"; _first=0; else printf '    %s\n' "$line"; fi
  done
  _shown=$LOG; [ -n "$DEMO" ] && _shown="$LOGS_SHOWN/$1.log"
  printf '    %sfull log: %s%s\n\n' "$DIM" "$_shown" "$R"
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
  echo "memory: $(awk '/MemTotal/ { printf "%d MB", $2 / 1024 }' /proc/meminfo)"
  free_kb=$(df -Pk / | awk 'NR == 2 { print $4 }')
  echo "free disk: $((free_kb / 1024)) MB"
  if [ "$free_kb" -lt 3000000 ]; then echo "needs at least 3 GB of free disk"; return 1; fi
  echo "system: ${PRETTY_NAME:-$ID} ($arch)"
}

do_basics() {
  apt_install curl ca-certificates gnupg iproute2 procps tar xz-utils bubblewrap socat
  bwrap_userns
}

# ubuntu 24.04 gives unprivileged user namespaces no capabilities (kernel.apparmor_restrict_unprivileged_userns=1), and
# the bot box is one: bubblewrap alone gets a profile that lets it make them
bwrap_userns() {
  [ -x /usr/bin/bwrap ] && [ -d /sys/kernel/security/apparmor ] && command -v apparmor_parser >/dev/null 2>&1 || return 0
  [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = 1 ] || return 0
  cat > "$TMP/new" <<'EOF'
# managed by duskbot-link: bubblewrap may make the user namespaces each bot's turn runs in
abi <abi/4.0>,
include <tunables/global>

profile duskbot-bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,

  include if exists <local/duskbot-bwrap>
}
EOF
  new_file /etc/apparmor.d/duskbot-bwrap
  install -d -m 0755 /etc/apparmor.d
  put_file /etc/apparmor.d/duskbot-bwrap 0644 || true
  x apparmor_parser -r /etc/apparmor.d/duskbot-bwrap
}

# what the server's box check does: a user namespace with its own pid, network and mounts, as maus
box_works() {
  as_user /usr/bin/bwrap --unshare-user --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent \
    --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
    --proc /proc --dev /dev --tmpfs /tmp /bin/true
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
    manifest_add "user $SVC_USER"
    x useradd --create-home --home-dir "$SVC_HOME" --shell /bin/bash "$SVC_USER"
  fi
  # security: the docker group is root-equivalent and the server runs bots; it reaches docker only through the gate
  if id -nG "$SVC_USER" | tr ' ' '\n' | grep -qx docker; then x gpasswd -d "$SVC_USER" docker; fi
  if ! getent group "$GATE_GROUP" >/dev/null 2>&1; then manifest_add "group $GATE_GROUP"; x groupadd --system "$GATE_GROUP"; fi
  usermod -aG "$GATE_GROUP" "$SVC_USER"
  if ! id "$GATE_USER" >/dev/null 2>&1; then
    manifest_add "user $GATE_USER"
    x useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --gid "$GATE_GROUP" "$GATE_USER"
  fi
  if getent group docker >/dev/null 2>&1; then usermod -aG docker "$GATE_USER"; fi
  if ! id "$LINK_USER" >/dev/null 2>&1; then
    manifest_add "user $LINK_USER"
    # a shell, so sshd can run the forced command on the app's restricted key
    x useradd --system --create-home --home-dir "$LINK_HOME" --shell /bin/sh "$LINK_USER"
  fi
  # useradd leaves the password "!" (locked), and sshd without PAM refuses every key for a locked account; "*" still
  # allows no password but lets the app's restricted direct key in (OpenSSH auth.c allowed_user)
  if [ "$(getent shadow "$LINK_USER" | cut -d: -f2)" = "!" ]; then usermod -p '*' "$LINK_USER"; fi
  for dir in "$LINK_HOME" "$LINK_HOME/.config" "$LINK_HOME/.config/duskbot-link" "$LINK_HOME/.ssh" "$HANDOFF"; do
    install -d -o "$LINK_USER" -g "$LINK_USER" -m 0700 "$dir"
  done
  install -d -o root -g root -m 0700 "$ETC"
  chmod 0700 "$SVC_HOME"
  for dir in "$SVC_HOME/.local" "$SVC_HOME/.cache" "$SVC_HOME/.config"; do
    install -d -o "$SVC_USER" -g "$SVC_USER" -m 0700 "$dir"
  done
  [ ! -d "$DATA" ] || chmod 0700 "$DATA"
  move_link_files
  move_engine_token
  seed_engine_home
  id "$SVC_USER"; id "$LINK_USER"; id "$GATE_USER"
}

# an older install kept the link agent's files in the server account's home; they move to omb-link, read as that
# account so no link in its home can point root at another file
move_link_files() {
  old="$SVC_HOME/.config/$OLD-link"
  new="$LINK_HOME/.config/duskbot-link/tunnel.json"
  if [ -f "$old/tunnel.json" ] && [ ! -f "$new" ]; then
    show mv "$old/tunnel.json" "$new"
    as_user cat "$old/tunnel.json" | runuser -u "$LINK_USER" -- sh -c 'umask 077; cat > "$1.tmp" && mv -f "$1.tmp" "$1"' sh "$new"
    [ -s "$new" ] || { echo "tunnel.json did not move"; return 1; }
  fi
  [ ! -d "$old" ] || as_user rm -rf "$old"
  keys="$SVC_HOME/.ssh/authorized_keys"
  if [ -f "$keys" ] && grep -q ' omb-link-[a-z2-7]\{10\}$' "$keys"; then
    # the app asks the agent for a new key over the sealed tunnel once this one is refused, and gets omb-link's
    as_user sh -c 'umask 077; grep -v " omb-link-[a-z2-7]\{10\}\$" "$1" > "$1.omb" || true; mv -f "$1.omb" "$1"' sh "$keys"
    [ -s "$keys" ] || as_user rm -f "$keys"
    echo "the app's direct key left $SVC_USER; it gets a new one for $LINK_USER"
  fi
}

# the engine token an older install kept in the server account's home goes to $ETC/engines.env, which only systemd reads
move_engine_token() {
  old="$SVC_HOME/.config/$OLD/engines.env"
  [ -f "$old" ] || return 0
  as_user cat "$old" | grep -E "$CLAUDE_TOKEN_LINE" | awk "length <= 4200" | tail -n 1 > "$TMP/engines.env" || true
  if [ -s "$TMP/engines.env" ]; then install -o root -g root -m 0600 "$TMP/engines.env" "$ETC/engines.env"; echo "the Claude sign-in moved to $ETC/engines.env"; fi
  rm -f "$TMP/engines.env"
  as_user rm -f "$old"
  as_user rmdir "$SVC_HOME/.config/$OLD" 2>/dev/null || true
}

# the bot box gives engines their own home in the data folder; conversations from before keep their engine sessions
seed_engine_home() {
  [ -d "$DATA" ] && [ ! -d "$DATA/engine-home" ] || return 0
  show "copy engine sessions into $DATA/engine-home"
  as_user sh -c 'set -e; umask 077; e="$1/engine-home.tmp"; rm -rf "$e"; mkdir -p "$e/.codex" "$e/.claude"
    for d in sessions archived_sessions; do [ ! -d "$2/.codex/$d" ] || cp -a "$2/.codex/$d" "$e/.codex/"; done
    for d in projects todos file-history; do [ ! -d "$2/.claude/$d" ] || cp -a "$2/.claude/$d" "$e/.claude/"; done
    [ ! -f "$2/.claude.json" ] || cp -p "$2/.claude.json" "$e/.claude.json"
    mv "$e" "$1/engine-home"' sh "$DATA" "$SVC_HOME"
}

# a server set up before the rename: its units stop and go, and its folders, link key, profiles and caddy site move to
# the new names. nothing is deleted but the old unit files and profile this script wrote; the old data folder and
# agent folder names stay as links to the new ones. safe to run again.
migrate_legacy() {
  found=0
  for unit in $OLD_UNITS; do [ -e "$UNITS/$unit" ] && found=1; done
  for dir in "$OLD_STATE" "$OLD_AGENT_DIR" "$OLD_ETC" "$SVC_HOME/.$OLD"; do [ -e "$dir" ] && [ ! -L "$dir" ] && found=1; done
  [ "$found" = 1 ] || return 0
  echo "moving an install from before the rename to the new names"
  for unit in $OLD_UNITS; do
    [ -e "$UNITS/$unit" ] || continue
    systemctl disable --now "$unit" >/dev/null 2>&1 || true
    rm -f "$UNITS/$unit" && echo "removed $UNITS/$unit"
  done
  rm -f "$UNITS/ssh.service.d/10-$OLD-oom.conf" "$UNITS/sshd.service.d/10-$OLD-oom.conf"
  systemctl daemon-reload >/dev/null 2>&1 || true
  move_old "$OLD_STATE" "$STATE"
  move_old "$OLD_LOGS" "$LOGS"
  move_old "${OLD_MANIFEST%/*}" "${MANIFEST%/*}"
  move_old "$OLD_AGENT_DIR" "${AGENT%/*}" link
  move_old "$OLD_LIB" "$LIB"
  move_old "$OLD_ETC" "$ETC"
  move_old "$LINK_HOME/.config/$OLD-link" "$LINK_HOME/.config/duskbot-link"
  move_old "$SVC_HOME/.$OLD" "$DATA" link
  [ ! -L "$SVC_HOME/.$OLD" ] || chown -h "$SVC_USER:$SVC_USER" "$SVC_HOME/.$OLD" 2>/dev/null || true
  keys="$LINK_HOME/.ssh/authorized_keys"
  if [ -f "$keys" ] && grep -q "$OLD_AGENT_DIR/" "$keys"; then sed -i "s#$OLD_AGENT_DIR/#${AGENT%/*}/#g" "$keys" && echo "the app's direct key runs the agent at ${AGENT%/*}"; fi
  if [ -f "$OLD_BWRAP_PROFILE" ]; then
    apparmor_parser -R "$OLD_BWRAP_PROFILE" >/dev/null 2>&1 || true
    rm -f "$OLD_BWRAP_PROFILE" && echo "removed $OLD_BWRAP_PROFILE"
  fi
  if [ -f "$OLD_CADDY_SITE" ]; then
    [ -e "$CADDY_SITE" ] || mv "$OLD_CADDY_SITE" "$CADDY_SITE"
    rm -f "$OLD_CADDY_SITE"
    [ ! -f "$CADDY_MAIN" ] || sed -i "s#managed by $OLD-link#managed by duskbot-link#; s#$OLD_CADDY_SITE#$CADDY_SITE#" "$CADDY_MAIN"
  fi
  [ ! -f "$MANIFEST" ] || sed -i "s#$OLD#duskbot#g" "$MANIFEST"
  return 0
}

# old new [link]: a folder moves once, never over one already there; with `link` the old name points at the new one
move_old() {
  [ -e "$1" ] && [ ! -L "$1" ] || return 0
  if [ -e "$2" ]; then echo "kept $1: $2 is already there"; return 0; fi
  install -d -m 0755 "${2%/*}"
  mv "$1" "$2" || return 1
  echo "moved $1 -> $2"
  [ "${3:-}" != link ] || ln -s "$2" "$1"
}

node_major() { /usr/bin/node -v 2>/dev/null | sed -e 's/^v//' -e 's/\..*//'; }
do_node() {
  major=$(node_major)
  if [ -n "$major" ] && [ "$major" -ge 24 ]; then node_version_line; return 0; fi
  install -d -m 0755 /etc/apt/keyrings
  fetch https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key "$TMP/nodesource.key"
  new_file /etc/apt/keyrings/nodesource.gpg; new_file /etc/apt/sources.list.d/nodesource.list
  x gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg "$TMP/nodesource.key"
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  rm -f "$TMP/apt-updated"
  apt_update
  apt_get_install nodejs
  major=$(node_major)
  [ -n "$major" ] && [ "$major" -ge 24 ] || { echo "node 24 did not install"; return 1; }
  node_version_line
}
node_version_line() { echo "node $(/usr/bin/node -v), npm $(/usr/bin/npm -v 2>/dev/null || echo none)"; }

# our own server build, which the link service hands only to this claimed session; the sha256 comes with the claim
PKG_SHA="" PKG_SIZE=0 PKG_VERSION=""
verified_download() { # url file sha256 size timeout label
  _url=$1 _file=$2 _sha=$3 _total=$4 _limit=$5 _label=$6
  _part="$_file.part"
  if [ -f "$_file" ] && [ "$(sha256sum "$_file" | cut -d' ' -f1)" = "$_sha" ]; then
    echo "using verified cached $_label"
    return 0
  fi
  rm -f "$_file"
  _attempt=1
  while [ "$_attempt" -le 3 ]; do
    [ ! -f "$TMP/cancelled" ] || return 130
    if [ -f "$_part" ]; then
      if [ "$(sha256sum "$_part" | cut -d' ' -f1)" = "$_sha" ]; then mv "$_part" "$_file"; return 0; fi
      _size=$(wc -c < "$_part" | tr -cd 0-9)
      if [ "$_total" -gt 0 ] && [ "$_size" -ge "$_total" ]; then echo "discarding incomplete or damaged cached $_label"; rm -f "$_part"; fi
    fi
    progress file "$_part" "$_total"
    _offset=0; [ ! -f "$_part" ] || _offset=$(wc -c < "$_part" | tr -cd 0-9)
    echo "downloading $_label: attempt $_attempt/3, resuming at $_offset bytes"
    show curl -fsSL --connect-timeout 15 --speed-limit 1 --speed-time 60 -m "$_limit" -C - "$_url" -o "$_part"
    if curl -fsSL --proto "$PROTO" --proto-redir "$PROTO" --connect-timeout 15 --speed-limit 1 --speed-time 60 -m "$_limit" -C - -H "authorization: Bearer $VPS_TOKEN" "$_url" -o "$_part"; then
      if [ "$(sha256sum "$_part" | cut -d' ' -f1)" = "$_sha" ]; then
        mv "$_part" "$_file"
        rm -f "$PROGRESS" "$PROGRESS.json"
        echo "sha256 verified: $_label"
        return 0
      fi
      echo "$_label checksum did not match; the next attempt starts fresh"
      rm -f "$_part"
    else
      _code=$?
      echo "$_label download attempt $_attempt/3 failed (curl $_code); received bytes remain cached"
      case "$_code" in 33|36) rm -f "$_part" ;; esac
    fi
    [ "$_attempt" -lt 3 ] || break
    echo "retrying $_label in $((_attempt * 5)) seconds"
    sleep $((_attempt * 5))
    _attempt=$((_attempt + 1))
  done
  rm -f "$PROGRESS" "$PROGRESS.json"
  echo "$_label could not be downloaded and verified after 3 attempts; paste the command again to resume"
  return 1
}

# updates that can't break a server (shared/update-guard.ts): a build is taken only when it is signed by a pinned release
# key (required once this server has taken one signed build), newer than the one here, at or above the signed floor and
# not on the signed block list; the build it replaces stays cached, and if the new one does not answer or fails its own
# self-test (server/update-state.ts) the one before is put back. the keys match apps/cloud-service/src/release-signing.ts.
RELEASE_KEYS="rel-2026-11:wtwZypDwVPBXZ25XsZOVpd0PZPBbVMhugheUj5_NLIM${DUSK_RELEASE_PUBLIC_KEYS:+,$DUSK_RELEASE_PUBLIC_KEYS}"
NODE_BIN=${NODE_BIN:-/usr/bin/node}
PKG_SIG="" POLICY_BODY="" POLICY_SIG=""
update_check() { # file sha256 -> "ok <version> signed|unsigned" or "refuse <reason> [version]"
  cat > "$TMP/update-check.js" <<'DUSK_CHECK'
const c = require("node:crypto"), fs = require("node:fs"), e = process.env, SEM = /^\d+\.\d+\.\d+$/;
const keys = (e.KEYS || "").split(",").map((s) => s.trim().split(":")).filter(([kid, x]) => kid && x).map(([kid, x]) => ({ kid, x }));
const cmp = (a, b) => { const p = (v) => (SEM.test(v || "") ? v.split(".").map(Number) : null), l = p(a), r = p(b); if (!l || !r) return l ? 1 : r ? -1 : 0; for (let i = 0; i < 3; i++) if (l[i] !== r[i]) return l[i] < r[i] ? -1 : 1; return 0; };
const out = (line) => { process.stdout.write(line + "\n"); process.exit(0); };
function verify(sig, kind, sha) {
  const p = String(sig || "").trim().split(".");
  if (p.length !== 4 || p[0] !== "r1") return null;
  const k = keys.find((x) => x.kid === p[1]);
  if (!k) return null;
  try {
    const pub = c.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: k.x }, format: "jwk" });
    if (!c.verify(null, Buffer.from(p.slice(0, 3).join(".")), pub, Buffer.from(p[3], "base64url"))) return null;
    const m = JSON.parse(Buffer.from(p[2], "base64url").toString());
    return m.v === 1 && m.kind === kind && m.sha256 === sha ? m : null;
  } catch { return null; }
}
let held = { serial: 0, floor: null, blocked: [] };
try { held = JSON.parse(fs.readFileSync(e.HELD_POLICY, "utf8")); } catch {}
if (e.POLICY_BODY && e.POLICY_SIG) {
  try {
    const body = Buffer.from(e.POLICY_BODY, "base64url").toString("utf8"), p = JSON.parse(body);
    const m = verify(e.POLICY_SIG, "update-policy", c.createHash("sha256").update(body).digest("hex"));
    if (m && m.name === "update-policy" && Number.isSafeInteger(p.serial) && m.version === String(p.serial) && p.serial > (held.serial || 0)
      && (p.floor === null || SEM.test(p.floor)) && Array.isArray(p.blocked) && p.blocked.every((v) => SEM.test(v))) {
      held = { serial: p.serial, floor: p.floor, blocked: p.blocked };
      fs.writeFileSync(e.HELD_POLICY, JSON.stringify(held), { mode: 0o600 });
    }
  } catch {}
}
let version = null;
if (e.SIG) { const m = verify(e.SIG, "vps-package", e.SHA); if (!m || !SEM.test(m.version)) out("refuse unsigned"); version = m.version; }
else { if (e.SIGNED_BEFORE === "1") out("refuse unsigned"); version = SEM.test(e.OFFER_VERSION || "") ? e.OFFER_VERSION : null; }
if (version) {
  if ((held.blocked || []).includes(version)) out("refuse blocked " + version);
  if (held.floor && cmp(version, held.floor) < 0) out("refuse below_floor " + version);
  if ((e.FAILED || "").split(",").includes(version)) out("refuse failed_here " + version);
  if (e.INSTALLED && cmp(version, e.INSTALLED) < 0) out("refuse older " + version);
}
out("ok " + (version || "unknown") + " " + (e.SIG ? "signed" : "unsigned"));
DUSK_CHECK
  KEYS="$RELEASE_KEYS" SHA="$2" SIG="$PKG_SIG" OFFER_VERSION="${PKG_VERSION:-}" POLICY_BODY="$POLICY_BODY" POLICY_SIG="$POLICY_SIG" \
    HELD_POLICY="$STATE/update-policy.json" INSTALLED="$(installed_version)" FAILED="$(state_get update-failed)" SIGNED_BEFORE="$(state_get signed)" \
    "$NODE_BIN" "$TMP/update-check.js" || echo "refuse check"
}
installed_version() { sed -n 's/^ *"version": *"\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)".*/\1/p' "$SVC_HOME/.local/lib/node_modules/duskbot/package.json" 2>/dev/null | head -n 1; }
# the server's own self-test on <version> (server/update-state.ts): passed, failed, or nothing yet
selftest_result() {
  "$NODE_BIN" -e 'try { const s = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).selfTest; if (s && s.version === process.argv[2]) console.log(s.ok ? "passed" : "failed"); } catch {}' "$DATA/update-state.json" "$1" 2>/dev/null || true
}
# after the server restarted on a new build: settles it, or puts the build before back. $1: 1 when the server answered
update_settle() {
  pending=$(state_get update-pending)
  [ -n "$pending" ] || return "$((1 - $1))"
  ok=$1
  if [ "$ok" = 1 ] && [ "$pending" != unknown ]; then
    _i=0 result=""
    while [ "$_i" -lt "${SELFTEST_WAIT:-180}" ]; do
      result=$(selftest_result "$pending")
      [ -z "$result" ] || break
      sleep 2; _i=$((_i + 2))
    done
    [ "$result" = passed ] || ok=0
  fi
  state_set update-pending ""
  if [ "$ok" = 1 ]; then echo "Updated to $pending"; return 0; fi
  prev=$(state_get package-prev)
  file="$SVC_HOME/.cache/duskbot-link/duskbot-${prev#sha256:}.tgz"
  case "$prev" in sha256:*) [ -f "$file" ] || prev="" ;; *) prev="" ;; esac
  if [ -z "$prev" ]; then echo "the update to $pending did not pass its self-test and there is no build here to go back to"; return 1; fi
  echo "the update to $pending did not pass its self-test: going back to the build before"
  failed=$(state_get update-failed)
  state_set update-failed "$(printf '%s\n' ${failed:+$(printf '%s' "$failed" | tr ',' ' ')} "$pending" | tail -n 20 | paste -sd, -)"
  retry as_user npm install --global --no-fund --no-audit --prefix "$SVC_HOME/.local" "$file" || return 1
  state_set package "$prev"; state_set package-prev ""
  x systemctl restart duskbot.service
  if wait_health "http://127.0.0.1:$PORT/api/health" 120; then echo "Update rolled back, nothing lost"; return 0; fi
  return 1
}

get_package() { # file
  verified_download "$LINK_BASE/pkg/$LINK_ID/$PKG_SHA.tgz" "$1" "$PKG_SHA" "$PKG_SIZE" 1800 Dusk Bot
}
do_app() {
  bin="$SVC_HOME/.local/bin/duskbot"
  if [ -n "$DUSK_PACKAGE" ]; then
    # explicit only: an npm spec or tarball url instead of our build
    if [ -x "$bin" ] && [ "$(state_get package)" = "npm:$DUSK_PACKAGE" ]; then echo "already installed: $DUSK_PACKAGE"; return 0; fi
    retry as_user npm install --global --no-fund --no-audit --prefix "$SVC_HOME/.local" "$DUSK_PACKAGE"
    [ -x "$bin" ] || { echo "duskbot is missing after install"; return 1; }
    state_set package "npm:$DUSK_PACKAGE"
    return 0
  fi
  if [ -z "$PKG_SHA" ]; then
    if [ -x "$bin" ] && [ "$OFFLINE" = 1 ]; then echo "keeping the installed build ($(state_get package))"; return 0; fi
    echo "the link service has no Dusk Bot build to hand out yet"
    return 1
  fi
  if [ -x "$bin" ] && [ "$(state_get package)" = "sha256:$PKG_SHA" ]; then echo "already installed: build ${PKG_SHA%"${PKG_SHA#????????????}"}"; return 0; fi
  cache="$SVC_HOME/.cache/duskbot-link"
  install -d -o "$SVC_USER" -g "$SVC_USER" -m 0700 "$cache"
  file="$cache/duskbot-$PKG_SHA.tgz"
  get_package "$file"
  verdict=$(update_check "$file" "$PKG_SHA")
  case "$verdict" in
    ok\ *) ;;
    *)
      [ "sha256:$PKG_SHA" = "$(state_get package-prev)" ] || rm -f "$file"
      if [ -x "$bin" ]; then echo "keeping the installed build: the offered one is not taken (${verdict#refuse })"; return 0; fi
      echo "the offered build is not taken (${verdict#refuse })"; return 1 ;;
  esac
  chown "$SVC_USER:$SVC_USER" "$file"
  prev=$(state_get package)
  # the build before stays cached: it is what a failed update goes back to
  find "$cache" -name 'duskbot-*.tgz*' ! -name "duskbot-$PKG_SHA.tgz" ! -name "duskbot-$PKG_SHA.tgz.part" ! -name "duskbot-${prev#sha256:}.tgz" -exec rm -f {} + 2>/dev/null || true
  retry as_user npm install --global --no-fund --no-audit --prefix "$SVC_HOME/.local" "$file"
  [ -x "$bin" ] || { echo "duskbot is missing after install"; return 1; }
  state_set package "sha256:$PKG_SHA"
  case "$verdict" in *" signed") state_set signed 1 ;; esac
  if [ -n "$prev" ] && [ "$prev" != "sha256:$PKG_SHA" ]; then
    state_set package-prev "$prev"; state_set update-pending "$(printf '%s' "$verdict" | cut -d' ' -f2)"
  fi
}

do_engines() {
  missing=""
  [ -x "$SVC_HOME/.local/bin/claude" ] || missing="$missing @anthropic-ai/claude-code"
  [ -x "$SVC_HOME/.local/bin/codex" ] || missing="$missing @openai/codex"
  [ -n "$missing" ] || { echo "already installed"; return 0; }
  # shellcheck disable=SC2086
  retry as_user npm install --global --no-fund --no-audit --prefix "$SVC_HOME/.local" $missing
}

# writes a file only when it changed; returns 0 when it wrote
put_file() { # path mode
  if [ -f "$1" ] && cmp -s "$TMP/new" "$1"; then return 1; fi
  install -m "$2" "$TMP/new" "$1"
  return 0
}

# what every unit here gets: no new privileges, no capabilities, the system read-only, a private /tmp. the server's unit
# leaves /proc and /dev as they are (ProtectKernelTunables, ProtectKernelLogs, ProcSubset, PrivateDevices): bubblewrap
# mounts a new proc and dev for each bot box, which a partly covered /proc or a private /dev refuses (systemd 255,
# linux 6.8, and lxc hosts)
HARDENING="NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
RestrictSUIDSGID=yes
ProtectSystem=strict
PrivateTmp=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectProc=invisible
LockPersonality=yes
RestrictRealtime=yes
KeyringMode=private
SystemCallArchitectures=native"

server_unit() {
  public=""
  [ "$(state_get mode)" = "direct" ] && public=" --public-url https://$(state_get host)"
  cat > "$TMP/new" <<EOF
# managed by duskbot-link
[Unit]
Description=Dusk Bot server
After=network-online.target omb-docker-gate.service
Wants=network-online.target

[Service]
User=$SVC_USER
Group=$SVC_USER
SupplementaryGroups=$GATE_GROUP
WorkingDirectory=$SVC_HOME
Environment=HOME=$SVC_HOME
Environment=PATH=$SVC_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
# every bot's turn in the bot box, in its own engine home, never unboxed; docker only through the gate
Environment=DUSK_BOT_BOX=required
Environment=DUSK_BOX_CODE_ROOTS=$SVC_HOME/.local/bin:$SVC_HOME/.local/lib
Environment=DUSK_VPS_DOCKER=local
Environment=DOCKER_HOST=unix://$GATE_SOCK
EnvironmentFile=-$ETC/engines.env
ExecStart=$SVC_HOME/.local/bin/duskbot serve --port $PORT --no-pair --label $NAME$public
Restart=always
RestartSec=5
# when memory runs out the kernel takes a bot computer (docker --oom-score-adj 500) long before the server
OOMScoreAdjust=-800
UMask=0077
$HARDENING
ProtectHome=tmpfs
BindPaths=$SVC_HOME
ReadWritePaths=$SVC_HOME
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK

[Install]
WantedBy=multi-user.target
EOF
  put_file "$UNITS/duskbot.service" 0644
}

handoff_script() {
  cat > "$TMP/new" <<EOF
#!/bin/sh
# managed by duskbot-link: takes what the link agent was handed for the server's engines to the server. the files
# are read as $LINK_USER and the codex sign-in written as $SVC_USER, so neither account can point root at another file.
set -eu
umask 077
restart=0
if [ -e $HANDOFF/engines.env ]; then
  runuser -u $LINK_USER -- cat $HANDOFF/engines.env | grep -E '$CLAUDE_TOKEN_LINE' | awk 'length <= 4200' | tail -n 1 > $ETC/engines.env.new || true
  if [ -s $ETC/engines.env.new ]; then mv -f $ETC/engines.env.new $ETC/engines.env; restart=1; else rm -f $ETC/engines.env.new; fi
  runuser -u $LINK_USER -- rm -f $HANDOFF/engines.env
fi
if [ -e $HANDOFF/codex-auth.json ]; then
  runuser -u $LINK_USER -- head -c 65536 $HANDOFF/codex-auth.json | runuser -u $SVC_USER -- sh -c 'umask 077; mkdir -p $SVC_HOME/.codex; cat > $SVC_HOME/.codex/.auth.json.handoff && mv -f $SVC_HOME/.codex/.auth.json.handoff $SVC_HOME/.codex/auth.json'
  runuser -u $LINK_USER -- rm -f $HANDOFF/codex-auth.json
fi
[ "\$restart" = 0 ] || systemctl restart duskbot.service
EOF
  install -d -m 0755 "$LIB"
  put_file "$LIB/engine-handoff.sh" 0755
}

helper_units() {
  changed=1
  cat > "$TMP/new" <<EOF
# managed by duskbot-link: the app sent an engine sign-in; the hand-off takes it to the server
[Unit]
Description=Dusk Bot engine sign-in handed off

[Path]
PathExists=$HANDOFF/engines.env
PathExists=$HANDOFF/codex-auth.json
Unit=duskbot-handoff.service

[Install]
WantedBy=multi-user.target
EOF
  put_file "$UNITS/duskbot-engines.path" 0644 && changed=0
  cat > "$TMP/new" <<EOF
# managed by duskbot-link
[Unit]
Description=Hand an engine sign-in to Dusk Bot

[Service]
Type=oneshot
ExecStart=/bin/sh $LIB/engine-handoff.sh
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
EOF
  put_file "$UNITS/duskbot-handoff.service" 0644 && changed=0
  if [ -f "$UNITS/duskbot-restart.service" ]; then rm -f "$UNITS/duskbot-restart.service"; changed=0; fi
  cat > "$TMP/new" <<EOF
# managed by duskbot-link: the outbound tunnel and control channel to the app
[Unit]
Description=Dusk Bot link
After=network-online.target duskbot.service
Wants=network-online.target

[Service]
User=$LINK_USER
Group=$LINK_USER
Environment=HOME=$LINK_HOME
Environment=DUSK_LINK_ENGINES_FILE=$HANDOFF/engines.env
Environment=DUSK_LINK_CODEX_AUTH_FILE=$HANDOFF/codex-auth.json
ExecStart=/usr/bin/node $AGENT tunnel
Restart=always
RestartSec=5
OOMScoreAdjust=-700
UMask=0077
$HARDENING
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelLogs=yes
ProtectHome=yes
ProtectHostname=yes
RestrictNamespaces=yes
ReadWritePaths=$LINK_HOME
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK

[Install]
WantedBy=multi-user.target
EOF
  put_file "$UNITS/duskbot-link.service" 0644 && changed=0
  cat > "$TMP/new" <<EOF
# managed by duskbot-link: the only way to docker on this server, for the server's own labelled bot computers
[Unit]
Description=Dusk Bot docker gate
After=docker.service
Requires=docker.service

[Service]
User=$GATE_USER
Group=$GATE_GROUP
SupplementaryGroups=docker
RuntimeDirectory=duskbot-docker
RuntimeDirectoryMode=0750
ExecStart=/usr/bin/node $GATE --listen $GATE_SOCK --upstream /var/run/docker.sock
Restart=always
RestartSec=2
UMask=0007
$HARDENING
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelLogs=yes
ProtectHome=yes
ProtectHostname=yes
RestrictNamespaces=yes
RestrictAddressFamilies=AF_UNIX
IPAddressDeny=any

[Install]
WantedBy=multi-user.target
EOF
  put_file "$UNITS/omb-docker-gate.service" 0644 && changed=0
  return "$changed"
}

get_gate() {
  install -d -o root -g root -m 0755 "$LIB"
  if fetch "$LINK_BASE/docker-gate.mjs" "$TMP/docker-gate.mjs" && /usr/bin/node --check "$TMP/docker-gate.mjs"; then
    install -o root -g root -m 0644 "$TMP/docker-gate.mjs" "$GATE"
  elif [ ! -f "$GATE" ]; then
    echo "could not download the docker gate"; return 1
  fi
}

# the gate up and answering maus, or why not; bots work without it, their computers do not
gate_up() {
  docker info >/dev/null 2>&1 || { echo "docker is not running; the docker gate waits for it"; return 0; }
  systemctl enable omb-docker-gate.service >/dev/null 2>&1
  x systemctl restart omb-docker-gate.service
  i=0
  while [ "$i" -lt 20 ]; do
    if as_user env DOCKER_HOST="unix://$GATE_SOCK" docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then echo "docker gate answers $SVC_USER on $GATE_SOCK"; return 0; fi
    sleep 1; i=$((i + 1))
  done
  echo "the docker gate did not answer; bot computers will not start"
  journalctl -u omb-docker-gate.service -n 20 --no-pager 2>/dev/null || true
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

# sshd is the way back in: never the kernel's choice, and its memory is not reclaimed away under pressure
SSH_GUARD="# managed by duskbot-link
[Service]
OOMScoreAdjust=-1000
MemoryMin=64M"
ssh_guard() {
  changed=1
  for unit in ssh sshd; do
    systemctl cat "$unit.service" >/dev/null 2>&1 || continue
    install -d -m 0755 "$UNITS/$unit.service.d"
    printf '%s\n' "$SSH_GUARD" > "$TMP/new"
    put_file "$UNITS/$unit.service.d/10-duskbot-oom.conf" 0644 && changed=0
    # the running daemon takes it now; a restart would only pick up the same value
    pid=$(systemctl show -p MainPID --value "$unit.service" 2>/dev/null)
    [ -n "$pid" ] && [ "$pid" != 0 ] && echo -1000 > "/proc/$pid/oom_score_adj" 2>/dev/null || true
  done
  return "$changed"
}

do_service() {
  reload=1
  get_gate || true
  handoff_script || true
  server_unit && reload=0
  helper_units && reload=0
  ssh_guard && reload=0
  [ "$reload" = 0 ] && x systemctl daemon-reload
  systemctl enable duskbot.service duskbot-engines.path >/dev/null 2>&1
  x systemctl restart duskbot-engines.path
  gate_up
  if box_works >/dev/null 2>&1; then echo "bot box: bubblewrap works for $SVC_USER"; else echo "bot box: bubblewrap cannot make a user namespace here; bots' turns are refused until it can"; fi
  if [ "$reload" = 0 ]; then x systemctl restart duskbot.service; else x systemctl start duskbot.service; fi
  show curl "http://127.0.0.1:$PORT/api/health"
  if wait_health "http://127.0.0.1:$PORT/api/health" 120; then echo "server answers on 127.0.0.1:$PORT"; update_settle 1 && return 0; return 1; fi
  echo "the server did not answer on 127.0.0.1:$PORT within two minutes"
  journalctl -u duskbot.service -n 30 --no-pager 2>/dev/null || true
  update_settle 0 && return 0
  return 1
}

get_agent() {
  install -d -o root -g root -m 0755 /opt/duskbot-link
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
    new_file /usr/share/keyrings/caddy-stable-archive-keyring.gpg; new_file /etc/apt/sources.list.d/caddy-stable.list
    x gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg "$TMP/caddy.key"
    chmod 0644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    fetch https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt /etc/apt/sources.list.d/caddy-stable.list
    rm -f "$TMP/apt-updated"
    apt_install caddy
  fi
  cat > "$TMP/new" <<EOF
# managed by duskbot-link
$1 {
	tls {
		# the app pins this server's key, so renewals keep it
		reuse_private_keys
	}
	encode zstd gzip
	handle /hooks/* {
		reverse_proxy 127.0.0.1:8800
	}
	# the app's direct path when its network blocks ssh: the link agent's websocket (sealed frames only)
	handle /omb-direct {
		reverse_proxy 127.0.0.1:8797
	}
	handle {
		reverse_proxy 127.0.0.1:$PORT {
			flush_interval -1
		}
	}
}
EOF
  install -d -m 0755 /etc/caddy
  put_file /etc/caddy/duskbot.caddy 0644 || true
  main=/etc/caddy/Caddyfile
  if [ ! -f "$main" ] || grep -q "managed by duskbot-link" "$main" || grep -q "/usr/share/caddy" "$main"; then
    if [ ! -f "$main" ]; then manifest_add "caddyfile new"
    elif ! grep -q "managed by duskbot-link" "$main"; then [ -f "$main.omb-before" ] || cp -p "$main" "$main.omb-before"; manifest_add "caddyfile replaced"; fi
    printf '# managed by duskbot-link\nimport /etc/caddy/duskbot.caddy\n' > "$main"
  elif ! grep -q "import /etc/caddy/duskbot.caddy" "$main"; then
    # someone else's caddy: add our site, never replace theirs
    printf '\nimport /etc/caddy/duskbot.caddy\n' >> "$main"
    manifest_add "caddyfile appended"
  fi
  x caddy validate --adapter caddyfile --config "$main"
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    for _port in 80/tcp 443/tcp; do ufw status 2>/dev/null | grep -q "^$_port " || manifest_add "ufw $_port"; done
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
  show node "$AGENT" probe
  out=$(LINK_BASE="$LINK_BASE" LINK_ID="$LINK_ID" LINK_TOKEN="$VPS_TOKEN" /usr/bin/node "$AGENT" probe 2>&1)
  code=$?
  set -e
  echo "$out"
  ip=$(printf '%s\n' "$out" | sed -n 's/^ip=\([0-9.]*\)$/\1/p' | head -n 1)
  if [ "$code" -ne 0 ] || [ -z "$ip" ]; then
    state_set mode relay
    echo "not reachable from the internet directly; using the private relay (nothing inbound is opened)"
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
  server_unit && systemctl daemon-reload && systemctl restart duskbot.service
  if wait_health "https://$host/api/health" 120; then echo "https://$host answers"; return 0; fi
  echo "https://$host did not answer in two minutes; using the private relay instead"
  state_set mode relay
  server_unit && systemctl daemon-reload && systemctl restart duskbot.service
  wait_health "http://127.0.0.1:$PORT/api/health" 120 || true
  return 0
}

install_output() {
  node --input-type=module -e '
import { once } from "node:events";
import { writeFileSync, renameSync } from "node:fs";
import { createInterface } from "node:readline";
const [file, kind] = process.argv.slice(1);
const seen = new Set(), finished = new Set(), transfers = new Map();
let previous = "", legacyTotal = 0, legacyStep = 0;
const bytes = (number, unit) => {
  const units = { b: 0, kb: 1, mb: 2, gb: 3, tb: 4, pb: 5, eb: 6 };
  const power = units[unit.toLowerCase().replace("i", "")];
  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(Number(number) * (unit.toLowerCase().includes("i") ? 1024 : 1000) ** power));
};
const emit = () => {
  const value = { kind, completed: finished.size, total: legacyTotal || seen.size, label: kind === "layers" ? "Image layers" : "Reported build operations" };
  if (!value.total) return;
  if (transfers.size) {
    value.receivedBytes = Math.min(Number.MAX_SAFE_INTEGER, [...transfers.values()].reduce((sum, entry) => sum + entry.received, 0));
    value.totalBytes = Math.min(Number.MAX_SAFE_INTEGER, [...transfers.values()].reduce((sum, entry) => sum + entry.total, 0));
  }
  const encoded = JSON.stringify(value);
  if (encoded === previous) return;
  previous = encoded;
  writeFileSync(file + ".json.tmp", encoded);
  renameSync(file + ".json.tmp", file + ".json");
  writeFileSync(file + ".tmp", `count ${value.completed} ${value.total} ${kind === "layers" ? "layers" : "steps"}\n`);
  renameSync(file + ".tmp", file);
};
for await (const raw of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!process.stdout.write(raw + "\n")) await once(process.stdout, "drain");
  const line = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  if (kind === "layers") {
    const layer = /^([a-f0-9]+):\s*(.*)$/i.exec(line);
    if (!layer || !/^(Pulling fs layer|Waiting|Already exists|Downloading|Download complete|Extracting|Pull complete)/.test(layer[2])) continue;
    const [, id, status] = layer;
    seen.add(id);
    if (/^(Pull complete|Already exists)/.test(status)) finished.add(id);
    const amount = /^Downloading.*?([0-9]+(?:\.[0-9]+)?)([kMGTPE]?i?B)\s*\/\s*([0-9]+(?:\.[0-9]+)?)([kMGTPE]?i?B)/i.exec(status);
    if (amount) transfers.set(id, { received: bytes(amount[1], amount[2]), total: bytes(amount[3], amount[4]) });
    if (/^(Download complete|Pull complete)/.test(status) && transfers.has(id)) transfers.get(id).received = transfers.get(id).total;
  } else {
    const vertex = /^#([0-9]+)(?:\s|$)/.exec(line);
    if (vertex) {
      seen.add(vertex[1]);
      if (/^#[0-9]+\s+(DONE|CACHED)(?:\s|$)/.test(line)) finished.add(vertex[1]);
    }
    const step = /^Step ([0-9]+)\/([0-9]+) :/.exec(line);
    if (step) { legacyStep = Number(step[1]); legacyTotal = Number(step[2]); seen.add(String(legacyStep)); }
    if (legacyStep && /^ ---> [a-f0-9]+$/.test(line)) finished.add(String(legacyStep));
  }
  emit();
}
' "$PROGRESS" "$1"
}

pull_with_progress() { # image
  rm -f "$TMP/pull.rc"
  { show docker pull "$1"; docker pull "$1" 2>&1; echo $? > "$TMP/pull.rc"; } | install_output layers
  rm -f "$PROGRESS" "$PROGRESS.json"
  [ "$(cat "$TMP/pull.rc" 2>/dev/null)" = 0 ]
}

# the bot desktop kit (deploy/bot-desktop + shared/bot-desktop.ts) from the link service, unpacked once per sha256
KIT_SHA="" KIT_SIZE=0 KIT=""
get_kit() {
  [ -n "$KIT_SHA" ] || { echo "the link service has no bot computer kit"; return 1; }
  KIT="$KIT_DIR/$KIT_SHA"
  [ -f "$KIT/deploy/bot-desktop/build.sh" ] && return 0
  install -d -m 0755 "$KIT_DIR"
  install -d -m 0700 "$KIT_DIR/.downloads"
  archive="$KIT_DIR/.downloads/$KIT_SHA.tgz"
  verified_download "$LINK_BASE/pkg/$LINK_ID/$KIT_SHA.tgz" "$archive" "$KIT_SHA" "$KIT_SIZE" 900 "bot computer kit" || return $?
  rm -rf "$KIT.tmp" && mkdir -p "$KIT.tmp"
  x tar -xzf "$archive" --no-same-owner -C "$KIT.tmp" || return 1
  find "$KIT_DIR" -mindepth 1 -maxdepth 1 ! -name "$KIT_SHA" ! -name "$KIT_SHA.tmp" ! -name .downloads -exec rm -rf {} + 2>/dev/null || true
  mv "$KIT.tmp" "$KIT"
  echo "kit $KIT_SHA unpacked in $KIT"
}

docker_has() { # runsc | userns
  case "$1" in
    runsc) docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q '"runsc"' ;;
    userns) docker info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q 'name=userns' ;;
  esac
}

# merges one setting into /etc/docker/daemon.json (keeping everything else), restarts docker, and puts the old file
# back if docker won't start with the new one. returns 1 when it had to roll back.
daemon_merge() { # gvisor | userns
  conf=/etc/docker/daemon.json
  install -d -m 0755 /etc/docker
  [ -f "$conf" ] && [ ! -f "$conf.omb-before" ] && cp -p "$conf" "$conf.omb-before"
  [ -f "$conf" ] || manifest_add "daemon-json new"
  [ -f "$conf" ] && cp -p "$conf" "$TMP/daemon.json.old"
  /usr/bin/node -e '
    const fs = require("fs"), [file, what, out] = process.argv.slice(1);
    let conf = {};
    try { conf = JSON.parse(fs.readFileSync(file, "utf8") || "{}"); } catch (e) { if (e.code !== "ENOENT") { console.error("daemon.json is not valid json; leaving it alone"); process.exit(3); } }
    if (what === "gvisor") conf.runtimes = { ...(conf.runtimes || {}), runsc: { path: "/usr/bin/runsc", runtimeArgs: ["--overlay2=none"] } };
    else conf["userns-remap"] = conf["userns-remap"] || "default";
    fs.writeFileSync(out, JSON.stringify(conf, null, 2) + "\n");
  ' "$conf" "$1" "$TMP/daemon.json.new" || return 1
  if [ -f "$conf" ] && cmp -s "$TMP/daemon.json.new" "$conf"; then echo "daemon.json already has it"; return 0; fi
  install -m 0644 "$TMP/daemon.json.new" "$conf"
  echo "daemon.json: added $1; restarting docker"
  x systemctl restart docker && docker_wait && { manifest_add "daemon-key $1"; return 0; }
  echo "docker would not start with the new daemon.json; putting the old one back"
  if [ -f "$TMP/daemon.json.old" ]; then install -m 0644 "$TMP/daemon.json.old" "$conf"; else rm -f "$conf"; fi
  systemctl reset-failed docker >/dev/null 2>&1 || true
  systemctl restart docker && docker_wait || true
  return 1
}
docker_wait() { i=0; while [ "$i" -lt 60 ]; do docker info >/dev/null 2>&1 && return 0; sleep 2; i=$((i + 2)); done; return 1; }

gvisor_install() {
  command -v runsc >/dev/null 2>&1 && return 0
  fetch https://gvisor.dev/archive.key "$TMP/gvisor.key"
  new_file /usr/share/keyrings/gvisor-archive-keyring.gpg; new_file /etc/apt/sources.list.d/gvisor.list
  x gpg --dearmor --yes -o /usr/share/keyrings/gvisor-archive-keyring.gpg "$TMP/gvisor.key"
  chmod 0644 /usr/share/keyrings/gvisor-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
    > /etc/apt/sources.list.d/gvisor.list
  rm -f "$TMP/apt-updated"
  apt_install runsc
}

# root in a bot computer must not be root here: gVisor when it installs and runs, else user-namespace remapping
do_sandbox() {
  docker info >/dev/null 2>&1 || { echo "docker is not running"; return 10; }
  if docker_has runsc; then echo "gVisor (runsc) already registered with docker"; return 0; fi
  if docker_has userns; then echo "user-namespace remapping already on"; return 0; fi
  if gvisor_install && daemon_merge gvisor && docker_has runsc; then
    runsc --version 2>/dev/null | head -n 1
    echo "gVisor registered with docker (--overlay2=none)"
    return 0
  fi
  echo "gVisor did not work here; using user-namespace remapping"
  if daemon_merge userns && docker_has userns; then echo "user-namespace remapping on"; return 0; fi
  echo "no sandbox, bot computers run strict"
  return 11
}

# boxes reach the public internet and nothing else; checked the way the server checks it
do_fence() {
  docker info >/dev/null 2>&1 || { echo "docker is not running"; return 10; }
  if get_kit; then
    command -v iptables >/dev/null 2>&1 || apt_install iptables
    install -m 0755 "$KIT/deploy/bot-desktop/host-fence.sh" /usr/local/sbin/omb-host-fence
    cat "$KIT/deploy/bot-desktop/omb-box-fence.service" > "$TMP/new"
    put_file "$UNITS/omb-box-fence.service" 0644 && systemctl daemon-reload
  elif [ ! -x /usr/local/sbin/omb-host-fence ] || [ ! -f "$UNITS/omb-box-fence.service" ]; then
    echo "no kit, bot computers run strict"; return 11
  fi
  systemctl enable omb-box-fence.service >/dev/null 2>&1
  # oneshot with RemainAfterExit: restart re-applies (the script is idempotent)
  x systemctl restart omb-box-fence.service
  if x /usr/local/sbin/omb-host-fence --check; then echo "fenced: omb-desk0 reaches the public internet only"; return 0; fi
  echo "fence check failed, bot computers run strict"
  return 11
}

build_with_progress() { # image dir
  rm -f "$TMP/build.rc"
  { show IMAGE="$1" sh "$2/build.sh"; IMAGE="$1" BUILDKIT_PROGRESS=plain sh "$2/build.sh" 2>&1; echo $? > "$TMP/build.rc"; } | install_output build
  rm -f "$PROGRESS" "$PROGRESS.json"
  [ "$(cat "$TMP/build.rc" 2>/dev/null)" = 0 ]
}

do_desktop() {
  [ -n "$BOT_DESKTOP_IMAGE" ] || { echo "no bot computer image named by the link service"; return 10; }
  docker info >/dev/null 2>&1 || { echo "docker is not running"; return 10; }
  state_set desktop-image "$BOT_DESKTOP_IMAGE"
  if docker image inspect "$BOT_DESKTOP_IMAGE" >/dev/null 2>&1; then echo "$BOT_DESKTOP_IMAGE is already here"; state_set desktop present; return 0; fi
  if pull_with_progress "$BOT_DESKTOP_IMAGE"; then state_set desktop pulled; echo "pulled $BOT_DESKTOP_IMAGE"; return 0; fi
  echo "no registry copy of $BOT_DESKTOP_IMAGE; building it here"
  get_kit || { echo "no kit, the app builds it on first use"; return 11; }
  # the bot computer's Dockerfile needs BuildKit (TARGETARCH); Ubuntu ships it as docker-buildx
  docker buildx version >/dev/null 2>&1 || apt_install docker-buildx || echo "no buildx; the bot computer can't be built here"
  if build_with_progress "$BOT_DESKTOP_IMAGE" "$KIT/deploy/bot-desktop" && docker image inspect "$BOT_DESKTOP_IMAGE" >/dev/null 2>&1; then
    state_set desktop built
    return 0
  fi
  echo "build failed, the app builds it on first use"
  return 11
}

do_link() {
  [ -f "$AGENT" ] || get_agent
  set +e
  show node "$AGENT" link
  runuser -u "$LINK_USER" -- env HOME="$LINK_HOME" LINK_BASE="$LINK_BASE" LINK_ID="$LINK_ID" LINK_TOKEN="$VPS_TOKEN" \
    LINK_MODE="$(state_get mode)" LINK_HOST="$(state_get host)" LINK_NAME="$NAME" /usr/bin/node "$AGENT" link
  code=$?
  set -e
  case "$code" in 0|4) ;; *) return 1 ;; esac
  state_set linked "$LINK_ID"
  start_link_service
  echo "linked as $NAME"
}

start_link_service() {
  helper_units && systemctl daemon-reload
  systemctl enable duskbot-link.service >/dev/null 2>&1
  x systemctl restart duskbot-link.service
}

# ---------- demo ----------
# DUSK_INSTALL_DEMO=1 sh install.sh: the real screen with pretend steps. writes only to its own temp dir.
demo_lines() { _d=$1; shift; for _l in "$@"; do sleep "$_d"; printf '%s\n' "$_l"; done; }
demo_bytes() { # total unit seconds*10
  _t=0
  while [ "$_t" -lt "$3" ]; do
    _t=$((_t + 1))
    progress bytes $(($1 * _t / $3)) "$1"
    sleep 0.1
  done
  rm -f "$PROGRESS"
}
demo_work() {
  case "$1" in
    check) demo_lines 0.2 "$ dpkg --print-architecture" "arm64" "$ . /etc/os-release" "$ df -Pk /"; demo_lines 0.3 "memory: 11953 MB" "free disk: 187214 MB" "system: Ubuntu 24.04.3 LTS (arm64)" ;;
    basics) demo_lines 0.35 "$ apt-get -q -o DPkg::Lock::Timeout=300 update" "Hit:1 http://ports.ubuntu.com/ubuntu-ports noble InRelease" \
      "Get:2 http://ports.ubuntu.com/ubuntu-ports noble-updates InRelease [126 kB]" "Reading package lists..." \
      "Unpacking gnupg (2.4.4-2ubuntu17.3) ..." "Setting up xz-utils (5.6.1+really5.4.5-1ubuntu0.2) ..." ;;
    docker) demo_lines 0.4 "Get:1 http://ports.ubuntu.com/ubuntu-ports noble-updates/universe arm64 docker.io 27.5.1 [28.6 MB]" \
      "Unpacking docker.io (27.5.1-0ubuntu3~24.04.2) ..." "Setting up containerd (1.7.27-0ubuntu1~24.04.1) ..." \
      "Created symlink /etc/systemd/system/sockets.target.wants/docker.socket" "Docker version 27.5.1, build 27.5.1" ;;
    user) demo_lines 0.3 "uid=1001(maus) gid=1001(maus) groups=1001(maus),988(docker)" ;;
    node) demo_lines 0.35 "$ curl -fsSL --connect-timeout 15 -m 300 https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o /tmp/nodesource.key" "$ apt-get -y -q install nodejs" "Get:1 https://deb.nodesource.com/node_24.x nodistro InRelease [12.1 kB]" \
      "Get:4 https://deb.nodesource.com/node_24.x nodistro/main arm64 nodejs 24.11.0-1nodesource1 [31.2 MB]" \
      "Unpacking nodejs (24.11.0-1nodesource1) ..." "node v24.11.0, npm 11.6.1" ;;
    app) echo "$ curl -fsSL -H 'authorization: Bearer [redacted]' https://link.dusk.bot/pkg/demodemoab/7c2f0a9e41d6.tgz"; echo "downloading Dusk Bot 0.1.141 (41.6 MB)"; demo_bytes 43620000 MB 32
      demo_lines 0.4 "sha256 ok: 7c2f0a9e41d6b3c88f1e2a07d95b6e4f3a10c2d8e7f6b5a4c3d2e1f0a9b8c7d6" \
        "added 3 packages in 2s" "changed 61 packages in 4s" ;;
    engines)
      demo_lines 0.5 "$ npm install --global --no-fund --no-audit --prefix /home/maus/.local @anthropic-ai/claude-code @openai/codex" "npm http fetch GET 200 https://registry.npmjs.org/@anthropic-ai%2fclaude-code 412ms" \
        "npm http fetch GET 200 https://registry.npmjs.org/@openai%2fcodex 388ms" \
        "npm http fetch GET 200 https://registry.npmjs.org/@openai/codex/-/codex-0.58.0-linux-arm64.tgz 2104ms"
      if [ "$DEMO" = fail ]; then
        demo_lines 0.4 "npm error code ETIMEDOUT" "npm error syscall connect" \
          "npm error errno ETIMEDOUT" "npm error network request to https://registry.npmjs.org/@openai%2fcodex failed, reason: connect ETIMEDOUT 104.16.2.35:443" \
          "npm error network This is a problem related to network connectivity." \
          "npm error A complete log of this run can be found in: /home/maus/.npm/_logs/2026-11-07T09_41_12_018Z-debug-0.log"
        return 1
      fi
      demo_lines 0.4 "added 4 packages in 6s" ;;
    service) demo_lines 0.5 "Created symlink /etc/systemd/system/multi-user.target.wants/duskbot.service" \
      "waiting for 127.0.0.1:8799/api/health" "server answers on 127.0.0.1:8799" ;;
    address) demo_lines 0.4 "probe: http://203.0.113.10/.well-known/omb-link/... refused" \
      "not reachable from the internet directly; using the private relay (nothing inbound is opened)" ;;
    sandbox) demo_lines 0.35 "Get:1 https://storage.googleapis.com/gvisor/releases release/main arm64 runsc 20251103.0 [24.1 MB]" \
      "Setting up runsc (20251103.0) ..." "daemon.json: added gvisor; restarting docker" "runsc version release-20251103.0" \
      "gVisor registered with docker (--overlay2=none)" ;;
    fence) echo "downloading the bot computer kit"; demo_bytes 236000 MB 4
      demo_lines 0.3 "Created symlink /etc/systemd/system/docker.service.wants/omb-box-fence.service" \
        "host-fence: boxes on omb-desk0 are fenced" "fenced: omb-desk0 reaches the public internet only" ;;
    desktop) demo_lines 0.3 "Error response from daemon: denied" "no registry copy of ghcr.io/sidddevz/omb-bot-desktop:v1; building it here"
      _k=0
      while [ "$_k" -lt 15 ]; do
        _k=$((_k + 1)); progress count "$_k" 15 steps
        echo "#$((_k + 6)) [stage-1 $_k/15] RUN apt-get install -y --no-install-recommends chromium tigervnc-standalone-server openbox"
        sleep 0.45
      done
      rm -f "$PROGRESS"; state_set desktop built; echo "built ghcr.io/sidddevz/omb-bot-desktop:v1 in 94s" ;;
    link) demo_lines 0.45 "pairing code issued" "sealed for the app (x25519 + aes-256-gcm)" "tunnel up" "linked as oracle-arm" ;;
  esac
}

# ---------- the end ----------
version_of() { # command... -> its first version-looking word
  "$@" 2>/dev/null | head -n 1 | grep -o '[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*' | head -n 1 || true
}
finale() {
  total=$(fmt_ms $(($(now_ms) - RUN_T0)))
  if [ -n "$DEMO" ]; then
    app="0.1.141, build 7c2f0a9e41d6" engines="Claude Code 2.0.37, Codex 0.58.0" node="v24.11.0"
    docker="29.1.3, gVisor sandbox, network fenced" link="private relay"
    computer="ghcr.io/sidddevz/omb-bot-desktop:v1, built here"
  else
    app=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$SVC_HOME/.local/lib/node_modules/duskbot/package.json" 2>/dev/null | head -n 1)
    pkg=$(state_get package)
    case "$pkg" in sha256:*) app="${app:-?}, build $(printf '%s' "${pkg#sha256:}" | cut -c1-12)" ;; npm:*) app="${app:-?}, from npm (${pkg#npm:})" ;; esac
    u="runuser -u $SVC_USER -- env HOME=$SVC_HOME PATH=$SVC_HOME/.local/bin:/usr/bin:/bin"
    # shellcheck disable=SC2086
    engines="Claude Code $(version_of timeout 10 $u claude --version), Codex $(version_of timeout 10 $u codex --version)"
    node=$(/usr/bin/node -v 2>/dev/null || echo "?")
    computer="not set up"
    if docker info >/dev/null 2>&1; then
      docker="$(version_of timeout 10 docker --version)"
      if docker_has runsc; then docker="$docker, gVisor sandbox"; elif docker_has userns; then docker="$docker, user-namespace sandbox"; else docker="$docker, no sandbox"; fi
      if /usr/local/sbin/omb-host-fence --check >/dev/null 2>&1; then docker="$docker, network fenced"; else docker="$docker, not fenced (strict boxes)"; fi
      if [ -n "$BOT_DESKTOP_IMAGE" ] && docker image inspect "$BOT_DESKTOP_IMAGE" >/dev/null 2>&1; then
        case "$(state_get desktop)" in built) how="built here" ;; pulled) how="pulled" ;; *) how="ready" ;; esac
        computer="$BOT_DESKTOP_IMAGE, $how"
      fi
    else
      docker="not running"
    fi
    if [ "$(state_get mode)" = direct ]; then link="https://$(state_get host)"; else link="private relay"; fi
  fi
  logs=$LOGS; [ -n "$DEMO" ] && logs="$LOGS_SHOWN (demo: nothing was written)"
  table=$(for _row in "app|$app" "engines|$engines" "node|$node" "docker|$docker" "computer|$computer" "link|$link" "logs|$logs"; do
    printf '%-10s %s\n' "${_row%%|*}" "${_row#*|}"
  done)
  [ -n "$DEMO" ] || printf '%s\n' "$table" > "$LOGS/summary.log"
  # the mascot settles
  mascot 0
  glyph ok; _ok=$G; glyph sep
  where="$NAME $G $SYS $ARCH $G $link"
  printf '\n  %s%s %sDusk Bot is ready%s  %s%s %s%s\n' "$OK" "$_ok" "$BOLD" "$R" "$DIM" "$G" "$total" "$R"
  printf '    %s%s%s\n\n' "$DIM" "$where" "$R"
  if [ "${DUSK_VERBOSE:-}" = 1 ]; then printf '%s\n' "$table" | sed 's/^/    /'; printf '\n'; fi
  printf '  %s%sYour bots now live here, go back to the app.%s\n\n' "$ACC" "$BOLD" "$R"
}



# ---------- session ----------
claim() {
  arch=$(dpkg --print-architecture 2>/dev/null || uname -m)
  # shellcheck disable=SC1091
  os=$(. /etc/os-release 2>/dev/null && echo "${ID:-unknown}-${VERSION_ID:-}")
  n=0
  while :; do
    status=$(curl -sS --proto "$PROTO" --proto-redir "$PROTO" -m 20 -o "$TMP/claim" -w '%{http_code}' -X POST -H "authorization: Bearer $VPS_TOKEN" \
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
    200)
      state_set id "$LINK_ID"
      PKG_SHA=$(sed -n 's/.*"package":{[^}]*"sha256":"\([0-9a-f]\{64\}\)".*/\1/p' "$TMP/claim" | head -n 1)
      PKG_SIZE=$(sed -n 's/.*"package":{[^}]*"size":\([0-9]\{1,12\}\).*/\1/p' "$TMP/claim" | head -n 1)
      PKG_VERSION=$(sed -n 's/.*"package":{[^}]*"version":"\([0-9A-Za-z.+-]\{1,40\}\)".*/\1/p' "$TMP/claim" | head -n 1)
      PKG_SIG=$(sed -n 's/.*"package":{[^}]*"signature":"\(r1\.[a-z0-9-]\{1,32\}\.[A-Za-z0-9_-]\{1,\}\.[A-Za-z0-9_-]\{40,\}\)".*/\1/p' "$TMP/claim" | head -n 1)
      POLICY_BODY=$(sed -n 's/.*"policy":{"body":"\([A-Za-z0-9_-]\{1,\}\)","signature":"\(r1\.[A-Za-z0-9._-]\{1,\}\)"}.*/\1/p' "$TMP/claim" | head -n 1)
      POLICY_SIG=$(sed -n 's/.*"policy":{"body":"\([A-Za-z0-9_-]\{1,\}\)","signature":"\(r1\.[A-Za-z0-9._-]\{1,\}\)"}.*/\2/p' "$TMP/claim" | head -n 1)
      PKG_SIZE=${PKG_SIZE:-0}
      KIT_SHA=$(sed -n 's/.*"desktop":{[^}]*"sha256":"\([0-9a-f]\{64\}\)".*/\1/p' "$TMP/claim" | head -n 1)
      KIT_SIZE=$(sed -n 's/.*"desktop":{[^}]*"size":\([0-9]\{1,12\}\).*/\1/p' "$TMP/claim" | head -n 1)
      KIT_SIZE=${KIT_SIZE:-0}
      image=$(sed -n 's/.*"desktop":{[^}]*"image":"\([A-Za-z0-9._/:-]\{1,200\}\)".*/\1/p' "$TMP/claim" | head -n 1)
      [ -n "$BOT_DESKTOP_IMAGE" ] || BOT_DESKTOP_IMAGE=$image ;;
    410|404)
      if [ -n "$(state_get linked)" ]; then
        OFFLINE=1
        [ -n "$BOT_DESKTOP_IMAGE" ] || BOT_DESKTOP_IMAGE=$(state_get desktop-image)
        return 0
      fi
      if [ "$status" = 410 ]; then fail_line "This line was already used. Make a new one in the app."; else fail_line "This command expired. Make a new one in the app."; fi
      exit 1 ;;

    401) fail_line "This line doesn't match. Copy it again from the app."; exit 1 ;;
    *) fail_line "The link service said no ($status). Make a new line in the app and try again."; exit 1 ;;
  esac
}

on_exit() {
  [ "$UI" = tty ] && printf '%s[?25h' "$ESC"
  rm -rf "$TMP"
}
on_stop() {
  trap '' INT TERM
  _children=$(ps -eo pid=,ppid= | awk -v root="$$" '{ parent[$1]=$2 } END { for (pid in parent) { nextpid=pid; for (n=0;n<100 && nextpid in parent;n++) { if (parent[nextpid]==root) { print pid; break; } nextpid=parent[nextpid]; } } }')
  [ -z "$_children" ] || kill -TERM $_children 2>/dev/null || true
  _pending=$_children _round=0
  while [ -n "$_pending" ] && [ "$_round" -lt 10 ]; do
    _alive=""
    for _pid in $_pending; do kill -0 "$_pid" 2>/dev/null && _alive="$_alive $_pid"; done
    _pending=$_alive
    [ -z "$_pending" ] || sleep 0.1
    _round=$((_round + 1))
  done
  [ -z "$_pending" ] || kill -KILL $_pending 2>/dev/null || true
  if [ -f "$TMP/cancelled" ]; then
    printf '\n\n  Setup was cancelled in the app. Installed files were kept. Make a new command in the app to resume.\n\n'
  else
    printf '\n\n  Stopped. Paste the line again; it picks up where it stopped.\n\n'
  fi
  exit 130
}

intro() {
  if [ -n "$DEMO" ]; then SYS="Ubuntu 24.04.3 LTS" ARCH=arm64; else
    # shellcheck disable=SC1091
    SYS=$(. /etc/os-release 2>/dev/null && printf '%s' "${PRETTY_NAME:-${ID:-linux}}")
    ARCH=$(dpkg --print-architecture 2>/dev/null || uname -m)
  fi
  who="session ${LINK_ID}"
  glyph sep
  _line="$who $G $NAME $G $SYS $ARCH"
  # the link address only when it fits (byte length, so a little conservative)
  [ $((${#_line} + ${#LINK_BASE} + 4)) -le "$COLS" ] && _line="$_line $G ${LINK_BASE#*://}"
  printf '  %s%s%s\n' "$DIM" "$_line" "$R"
  say ""
}

main() {
  if [ -n "$DEMO" ]; then
    TOKEN="demodemoab-$(printf '%026d' 0 | tr 0 a)"
  fi
  # a server set up before the rename moves to the new names before anything here reads them
  if [ -z "$DEMO" ] && [ "$(id -u)" -eq 0 ]; then MIGRATED=$(migrate_legacy 2>&1) || true; fi
  # `sh install.sh --repair` as root: an install that is already linked, checked and brought up to date without a line
  if [ "$TOKEN" = "--repair" ]; then
    [ "$(id -u)" -eq 0 ] || become_root
    [ -f "$STATE/linked" ] && [ -f "$STATE/id" ] || { fail_line "--repair needs an install that is already linked. Paste a line from the app instead."; exit 1; }
    TOKEN="$(cat "$STATE/id")-$(printf '%026d' 0 | tr 0 a)"
    REPAIR=1
  fi
  case "$TOKEN" in
    [a-z2-7][a-z2-7][a-z2-7][a-z2-7][a-z2-7][a-z2-7][a-z2-7][a-z2-7][a-z2-7][a-z2-7]-*) ;;
    *) fail_line "This line is missing its code. Copy the whole line from the app."; exit 1 ;;
  esac
  LINK_ID=${TOKEN%%-*}
  SECRET=${TOKEN#*-}
  if [ "${#SECRET}" -ne 26 ] || printf '%s' "$SECRET" | grep -q '[^a-z2-7]'; then
    fail_line "This line is missing its code. Copy the whole line from the app."; exit 1
  fi
  [ -n "$DEMO" ] || become_root
  umask 022
  TMP=$(mktemp -d)
  PROGRESS="$TMP/progress"
  if [ -n "$DEMO" ]; then STATE="$TMP/state" LOGS="$TMP/logs" LINK_BASE="https://link.dusk.bot"; fi
  install -d -m 0700 "$STATE"
  install -d -m 0700 "$LOGS"
  [ -z "${MIGRATED:-}" ] || printf '%s\n' "$MIGRATED" >> "$LOGS/migrate.log"
  ui_init
  trap on_exit EXIT
  trap on_stop INT TERM
  [ "$UI" = tty ] && printf '%s[?25l' "$ESC"
  if [ -z "$DEMO" ]; then
    command -v curl >/dev/null 2>&1 || apt_install curl ca-certificates </dev/null >/dev/null
    VPS_TOKEN=$(printf '%s' "omb-link-v1|vps|$SECRET" | sha256sum | cut -d' ' -f1)
    NAME=$(hostname -s 2>/dev/null | tr -cd 'A-Za-z0-9.-' | cut -c1-40)
  else
    VPS_TOKEN="" NAME=oracle-arm
  fi
  [ -n "$NAME" ] || NAME=vps
  RUN_T0=$(now_ms)

  banner
  if [ "$REPAIR" = 1 ]; then
    OFFLINE=1
    [ -n "$BOT_DESKTOP_IMAGE" ] || BOT_DESKTOP_IMAGE=$(state_get desktop-image)
  elif [ -z "$DEMO" ]; then claim; fi
  intro
  if [ "$OFFLINE" = 1 ]; then printf '  %sThis server is already linked. Checking everything is up to date.%s\n\n' "$DIM" "$R"; BELOW_TAG=5; fi
  checklist

  phase prepare; step check do_check; step basics do_basics; step docker do_docker; step user do_user; phase_end
  phase runtime; step node do_node; phase_end
  phase omb; step app do_app; step engines do_engines; step service do_service; phase_end
  phase computer; step sandbox do_sandbox; step fence do_fence; step desktop do_desktop; phase_end
  phase link; step address do_address
  if [ "$OFFLINE" = 1 ]; then
    [ -f "$AGENT" ] && start_link_service
    PH_NOTE="already linked"
  else
    step link do_link
  fi
  phase_end
  finale
}

main "$@"
