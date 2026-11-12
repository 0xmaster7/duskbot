#!/usr/bin/env bash
# installs the backup scripts and units on the vps and turns on each set's daily timer. the env files, rclone.conf
# (remotes oracle-backup and r2-backup) and the age recipient are set up by hand once (backup.env.example).
#   deploy/account/backup-install.sh [ssh host] [sets...]    # default: contabo dusk make
set -euo pipefail
host="${1:-contabo}"; [ $# -gt 0 ] && shift
if [ $# -gt 0 ]; then sets=("$@"); else sets=(dusk make); fi
cd "$(dirname "$0")/../.."
ssh "$host" 'install -d -m 755 /opt/dusk-backup && install -d -m 700 /etc/dusk-backup'
scp -q deploy/account/backup.sh deploy/account/backup-alert.mjs deploy/monitor/uptime-check.mjs "$host:/opt/dusk-backup/"
scp -q deploy/account/dusk-backup@.service deploy/account/dusk-backup@.timer "$host:/etc/systemd/system/"
ssh "$host" "chmod 755 /opt/dusk-backup/backup.sh && systemctl daemon-reload && for s in ${sets[*]}; do
  [ -f /etc/dusk-backup/\$s.env ] || { echo \"missing /etc/dusk-backup/\$s.env\" >&2; exit 1; }
  systemctl enable --now dusk-backup@\$s.timer; done && systemctl list-timers --no-pager 'dusk-backup@*'"
