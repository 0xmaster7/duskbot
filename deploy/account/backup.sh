#!/bin/sh
# encrypted, off-box backup of the account service's data folder. run daily by dusk-account-backup.timer as root.
#   DUSK_DASHBOARD_DATA   the data folder (required)
#   DUSK_BACKUP_RECIPIENT age public key (age1...); only its private half, kept off this box, can open a backup
#   DUSK_BACKUP_DEST      rclone destination, e.g. oci-backups:dusk-account or b2:dusk-backups/account (or a local path)
#   DUSK_BACKUP_KEEP_DAYS days kept at the destination (default 30)
# restore: rclone copy <dest>/<file> . && age -d -i key.txt <file> | tar -xz -C /var/lib/dusk-account-restore
set -eu

DATA="${DUSK_DASHBOARD_DATA:?set DUSK_DASHBOARD_DATA}"
RECIPIENT="${DUSK_BACKUP_RECIPIENT:?set DUSK_BACKUP_RECIPIENT}"
DEST="${DUSK_BACKUP_DEST:?set DUSK_BACKUP_DEST}"
KEEP="${DUSK_BACKUP_KEEP_DAYS:-30}"
case "$RECIPIENT" in age1*) ;; *) echo "DUSK_BACKUP_RECIPIENT must be an age public key" >&2; exit 2 ;; esac
case "$KEEP" in ''|*[!0-9]*) echo "DUSK_BACKUP_KEEP_DAYS must be a number" >&2; exit 2 ;; esac
[ -d "$DATA" ] || { echo "no data folder at $DATA" >&2; exit 1; }

umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
name="dusk-account-$(date -u +%Y%m%dT%H%M%SZ).tar.gz.age"
# the service writes each file by rename, so a copy holds whole files; the copy keeps tar from reading a moving tree
cp -a "$DATA" "$work/data"
tar -C "$work" -czf - data | age -r "$RECIPIENT" -o "$work/$name"
[ -s "$work/$name" ] || { echo "empty backup" >&2; exit 1; }
rclone copyto "$work/$name" "$DEST/$name"
rclone delete "$DEST" --min-age "${KEEP}d" --include 'dusk-account-*.tar.gz.age'
echo "backed up $DATA to $DEST/$name ($(wc -c < "$work/$name") bytes)"
