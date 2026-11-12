#!/bin/sh
# encrypted, off-box backup of the account service's data folder. run daily by dusk-account-backup.timer as root.
#   DUSK_DASHBOARD_DATA   the data folder (required)
#   DUSK_BACKUP_RECIPIENT age public key (age1...); only its private half, kept off this box, can open a backup
#   DUSK_BACKUP_DEST      rclone destination, e.g. oci-backups:dusk-account or b2:dusk-backups/account (or a local path)
#   DUSK_BACKUP_KEEP_DAYS days kept at the destination (default 30)
#   DUSK_BACKUP_MONGO_DIR the on-box mongodump folder (/root/backups/mongo-dusk); its newest finished dump goes in the same
#                         archive, so the database (the system of record) is off the box too. unset skips it.
# restore: rclone copy <dest>/<file> . && age -d -i key.txt <file> | tar -xz -C /var/lib/dusk-account-restore
#          then mongorestore --drop from /var/lib/dusk-account-restore/mongo/<dump> into a stopped service's database
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
parts=data
if [ -n "${DUSK_BACKUP_MONGO_DIR:-}" ]; then
  [ -d "$DUSK_BACKUP_MONGO_DIR" ] || { echo "no mongodump folder at $DUSK_BACKUP_MONGO_DIR" >&2; exit 1; }
  # a dump younger than 30 minutes may still be being written
  dump=$(find "$DUSK_BACKUP_MONGO_DIR" -mindepth 1 -maxdepth 1 -mmin +30 -exec ls -1dt {} + | head -n 1)
  [ -n "$dump" ] || { echo "no finished mongodump in $DUSK_BACKUP_MONGO_DIR" >&2; exit 1; }
  mkdir "$work/mongo"
  cp -a "$dump" "$work/mongo/"
  parts="data mongo"
fi
# shellcheck disable=SC2086
tar -C "$work" -czf - $parts | age -r "$RECIPIENT" -o "$work/$name"
[ -s "$work/$name" ] || { echo "empty backup" >&2; exit 1; }
rclone copyto "$work/$name" "$DEST/$name"
rclone delete "$DEST" --min-age "${KEEP}d" --include 'dusk-account-*.tar.gz.age'
echo "backed up $DATA to $DEST/$name ($(wc -c < "$work/$name") bytes)"
