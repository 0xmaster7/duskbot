# sourced by the store build scripts: exports named keys from dusk.env without echoing them or sourcing the whole file.
#   . "$(dirname "$0")/release-env.sh"; dusk_env_load KEY [KEY...]
DUSK_ENV_FILE="${DUSK_ENV_FILE:-$HOME/.config/duskbot/dusk.env}"

dusk_env_load() {
  [ -r "$DUSK_ENV_FILE" ] || return 0
  for key in "$@"; do
    # a value already in the environment wins
    eval "current=\${$key:-}"
    [ -n "$current" ] && continue
    line=$(grep -m1 "^${key}=" "$DUSK_ENV_FILE" 2>/dev/null || true)
    [ -n "$line" ] || continue
    value=${line#*=}
    case "$value" in \"*\") value=${value#\"}; value=${value%\"} ;; \'*\') value=${value#\'}; value=${value%\'} ;; esac
    export "$key=$value"
  done
  unset current line value
}
