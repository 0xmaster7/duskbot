// What runs on an InstaBox machine to make it a My Cloud home: the same setup and control as on Boat (home.ts) with
// InstaBox's layout. InstaBox facts this relies on (docs read and a live machine checked 2026-11-11): /data is the
// machine's persistent ext4 disk and also holds the machine user's home (/data/home), TMPDIR (/data/tmp), the platform's
// own folders and swap; exec and file uploads run as that user (passwordless sudo); a pause keeps memory and processes,
// so nothing has to stop before it.
import { CLOUD_HOME } from "../../../electron/legacy-names.mjs";
import type { MachineImage } from "./provider.ts";
import { BOAT_CONTROL, BOAT_NODE_BIN, PRE_STOP_FLAG, ROLLBACK_COMMAND, backupKey, bootContent, claimBootFile, homeSetupScript, packageInstallCommand, startCommand, type HostLayout } from "./home.ts";

export const INSTABOX_USER_HOME = "/data/home";
export const INSTABOX_BOOT_FILE = `${INSTABOX_USER_HOME}/.omb-boot.json`;
export const INSTABOX_PACKAGE_FILE = `${INSTABOX_USER_HOME}/omb-home.tgz`;
export const INSTABOX_RESTORE_FILE = `${INSTABOX_USER_HOME}/omb-restore.tar`;
export const INSTABOX_SNAPSHOT_FILE = `${INSTABOX_USER_HOME}/.omb-snapshot.tar`;
export const INSTABOX_SETUP_FILE = `${INSTABOX_USER_HOME}/.omb-setup.sh`;
export const INSTABOX_SETUP_LOG = `${INSTABOX_USER_HOME}/.omb-setup.log`;
export const INSTABOX_SETUP_STATUS = `${INSTABOX_USER_HOME}/.omb-setup.status`;
/** the volume's name inside a backup tar (`data/...`), the same layout a Boat backup restores from */
export const INSTABOX_HOME_VOLUME = "data";
/** entries of /data that are the platform's (the machine user's home, TMPDIR, its own state, swap) or a step's scratch:
 *  never in a backup, never replaced by a restore */
export const PLATFORM_ENTRIES = ["home", "tmp", "workspace", "config", "state", "swapfile", "lost+found", ".instabox*", ".omb-restore.*", ".omb-old.*"] as const;

const platformCase = PLATFORM_ENTRIES.join("|");
const excludes = PLATFORM_ENTRIES.map(e => `--exclude='data/${e}'`).join(" ");
/** an online SQLite backup (consistent while the home writes); a file that is not a database is copied as it is */
const DB_COPY = `const { DatabaseSync, backup } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1], { readOnly: true });
backup(db, process.argv[2]).then(() => { db.close(); }, () => { db.close(); process.exit(1); });`;

export const INSTABOX_LAYOUT: HostLayout = {
  bootFile: INSTABOX_BOOT_FILE, packageFile: INSTABOX_PACKAGE_FILE, restoreFile: INSTABOX_RESTORE_FILE,
  // the mount point stays traversable for the machine user, whose home is inside it
  volumeDirs: `sudo install -d -o maus -g maus -m 0711 /data
sudo install -d -o maus -g maus -m 0700 ${CLOUD_HOME.data}`,
  hostSetup: "",
  restore: `  restore)
    file="$2"
    systemctl stop omb-home.service >/dev/null 2>&1 || true
    machine="$(cat ${CLOUD_HOME.etc}/machine)"
    platform() { case "$1" in ${platformCase}) return 0 ;; esac; return 1; }
    stage="$(mktemp -d /data/.omb-restore.XXXXXX)"
    tar -xf "$file" -C "$stage" --numeric-owner --no-same-permissions --delay-directory-restore
    marker="$(find "$stage" -maxdepth 3 -name .omb-cloud-home.json -type f | head -n 1)"
    [ -n "$marker" ] || { rm -rf "$stage"; echo "not a home backup"; exit 2; }
    grep -q "\\"$machine\\"" "$marker" || { rm -rf "$stage"; echo "another cloud's backup"; exit 2; }
    root="$(dirname "$marker")"
    link="$(mktemp)"; cp ${CLOUD_HOME.data}/dashboard-link.json "$link"
    old="$(mktemp -d /data/.omb-old.XXXXXX)"
    shopt -s dotglob nullglob
    for entry in /data/*; do platform "\${entry##*/}" || mv "$entry" "$old/"; done
    for entry in "$root"/*; do platform "\${entry##*/}" || mv "$entry" /data/; done
    install -d -o maus -g maus -m 0700 ${CLOUD_HOME.data}
    install -o maus -g maus -m 0600 "$link" ${CLOUD_HOME.data}/dashboard-link.json
    for entry in /data/*; do platform "\${entry##*/}" || chown -R maus:maus "$entry"; done
    chown maus:maus /data; chmod 0711 /data; rm -rf "$stage" "$old" "$link" "$file"
    echo restored ;;
`,
  // a resume that kept memory left the home running with this origin: nothing to restart
  startKeep: `    if systemctl is-active --quiet omb-home.service && grep -qxF "DUSK_PUBLIC_URL=$origin" ${CLOUD_HOME.etc}/home.env && grep -qxF "DUSK_CLOUD_UPSTREAM_HOST=\${upstream#https://}" ${CLOUD_HOME.etc}/home.env \\
      && curl -fsS -m 2 http://127.0.0.1:8799/api/health >/dev/null 2>&1; then rm -f ${PRE_STOP_FLAG}; echo started; exit 0; fi
`,
  extraCommands: `  snapshot)
    # the volume as a backup reads it, from the running home: each SQLite database through an online backup, the rest as it is
    out=${INSTABOX_SNAPSHOT_FILE}; part="$out.part"; rm -f "$out" "$part"
    dbs="$(mktemp -d ${INSTABOX_USER_HOME}/.omb-dbs.XXXXXX)"
    sync
    while IFS= read -r -d '' db; do
      install -d "$dbs/$(dirname "$db")"
      ${BOAT_NODE_BIN} -e ${shellQuoted(DB_COPY)} "/$db" "$dbs/$db" 2>/dev/null || cp -p "/$db" "$dbs/$db"
      chown --reference="/$db" "$dbs/$db"
    done < <(cd / && find data ${PLATFORM_ENTRIES.map(e => `-path 'data/${e}' -prune -o`).join(" ")} -type f -name '*.db' -print0)
    code=0; tar -C / --numeric-owner -cf "$part" ${excludes} --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' --exclude='*.db-journal' data || code=$?
    # 1: a file changed while it was read (the home runs); anything more is a failure
    [ "$code" -le 1 ] || { rm -rf "$dbs" "$part"; echo "snapshot failed"; exit 3; }
    if [ -d "$dbs/data" ]; then tar -C "$dbs" --numeric-owner -rf "$part" data; fi
    rm -rf "$dbs"; chown user:user "$part"; chmod 0600 "$part"; mv "$part" "$out"
    echo "snapshot $(stat -c %s "$out")" ;;
  snapshot-done) rm -f ${INSTABOX_SNAPSHOT_FILE}; echo removed ;;
  verify)
    # a migration's manifest (sha256sum lines, absolute paths): the files that differ, then the count
    bad="$(cd / && sha256sum -c --quiet "$2" 2>/dev/null | head -n 50 || true)"
    printf '%s\\n' "$bad"; echo "mismatched $(printf '%s' "$bad" | grep -c . || true)" ;;
`,
  usage: "install|rollback|restore|start|stop|status|verify-template|tree|resume-if-cancelled|snapshot|snapshot-done|verify",
};

function shellQuoted(value: string): string { return `'${value.replace(/'/g, "'\\''")}'`; }

export const INSTABOX_SNAPSHOT_COMMAND = `sudo -n ${BOAT_CONTROL} snapshot`;
export const INSTABOX_SNAPSHOT_DONE_COMMAND = `sudo -n ${BOAT_CONTROL} snapshot-done`;
export const INSTABOX_RESTORE_COMMAND = `sudo -n ${BOAT_CONTROL} restore ${INSTABOX_RESTORE_FILE}`;

export const INSTABOX_IMAGE: MachineImage = {
  homeVolume: INSTABOX_HOME_VOLUME, packagePath: INSTABOX_PACKAGE_FILE, restorePath: INSTABOX_RESTORE_FILE,
  bootFile: input => ({ path: INSTABOX_BOOT_FILE, content: JSON.stringify(bootContent(input)) }),
  claimBootFile: input => ({ ...claimBootFile(input), path: INSTABOX_BOOT_FILE }),
  bootContent,
  setupScript: options => homeSetupScript(options, INSTABOX_LAYOUT),
  installCommand: (sha256, url, signature, floor) => packageInstallCommand(INSTABOX_PACKAGE_FILE, sha256, url, signature, floor),
  startCommand, restoreCommand: INSTABOX_RESTORE_COMMAND, rollbackCommand: ROLLBACK_COMMAND, legacyBackupKey: backupKey,
};
