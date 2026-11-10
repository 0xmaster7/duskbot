// What runs on a Boat sandbox to make it a My Cloud home: the same launcher, edge and server as every Cloud home
// (server/cloud-home-start.ts, apps/cloud-service/deploy/Caddyfile), installed natively under systemd so it comes back after every resume.
// Boat runs the setup script once, as `user` with passwordless sudo; every later step is one command the reconciler sends.
import { CLOUD_HOME } from "../../../electron/legacy-names.mjs";
import { createHmac } from "node:crypto";
import { CLOUD_HOME_MARKER_FILE, homeEnv, shellQuote, type DashboardLink } from "../../dashboard/server/clouds/bootstrap.ts";
import type { MachineImage, HomeBootInput } from "./provider.ts";
import { machineVerifyScript, type ReleaseKey } from "./release-signing.ts";

/** pinned runtime downloads, verified before use */
export const BOAT_NODE = { version: "24.22.2", sha256: "48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75" } as const;
export const BOAT_CADDY = { version: "2.10.2", sha512: "747df7ee74de188485157a383633a1a963fd9233b71fbb4a69ddcbcc589ce4e2cc82dacf5dbbe136cb51d17e14c59daeb5d9bc92487610b0f3b93680b2646546" } as const;
/** where the boot secrets land before the setup script moves them out of the user's reach (Boat writes `files` only under /home/user or /tmp) */
export const BOAT_BOOT_FILE = "/home/user/.omb-boot.json";
export const BOAT_PACKAGE_FILE = "/home/user/omb-home.tgz";
export const BOAT_RESTORE_FILE = "/home/user/omb-restore.tar";
/** the home's volume as Boat's snapshot reads name it: everything outside /home/user is under __system__ (seen 2026-11-09) */
export const BOAT_HOME_VOLUME = "__system__/data";
// /usr/local and /opt belong to the sandbox user on Boat; the launcher runs only root's code (codeTrustProblem)
// the whole Node distribution, npm with it: the server installs engine CLIs with npm into its own data folder (engine-install.ts)
const ROOT = CLOUD_HOME.root, APP = `${ROOT}/app`, BIN = `${ROOT}/bin`, NODE_DIR = `${ROOT}/node`;
export const BOAT_NODE_BIN = `${NODE_DIR}/bin/node`;
export const BOAT_CONTROL = `${BIN}/omb-home`;
/** set by the pre-stop hook while the provider saves the disk; the home's unit will not start while it exists */
export const PRE_STOP_FLAG = `${CLOUD_HOME.run}/pre-stop`;
/** merges cgroup-parent into docker's daemon.json; exits 0 only when it changed the file */
const DOCKER_SLICE = `const fs = require("node:fs"), p = "/etc/docker/daemon.json";
let c = {}; try { c = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
if (c["cgroup-parent"] === "omb-bots.slice") process.exit(1);
c["cgroup-parent"] = "omb-bots.slice";
fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\\n");`;

export type BoatBootInput = HomeBootInput;

/** what a machine needs to become this cloud's home: its env (the bootstrap secret among it), its dashboard link, its id */
export function bootContent(input: BoatBootInput): { v: 1; env: Record<string, string>; link: DashboardLink; machine: string } {
  const env = { ...homeEnv({ ...input, origin: "https://pending.invalid" }), DUSK_CLOUD_EDGE_HOLD: "30s" };
  return { v: 1, env, link: input.link, machine: input.cloudId };
}

/** the per-cloud secrets as one boot file (a loopback service only: no machine can reach it to redeem a claim) */
export function boatBootFile(input: BoatBootInput): { path: string; content: string } {
  return { path: BOAT_BOOT_FILE, content: JSON.stringify(bootContent(input)) };
}

/** the one-time claim the machine redeems at first boot for its boot content: the provider's API never carries a secret */
export function claimBootFile(input: { cloudId: string; claim: string; redeem: string }): { path: string; content: string } {
  if (!/^c[0-9a-f]{24}$/.test(input.cloudId) || !/^[A-Za-z0-9_-]{43}$/.test(input.claim) || !input.redeem.startsWith("https://")) throw new Error("Invalid machine claim.");
  return { path: BOAT_BOOT_FILE, content: JSON.stringify({ v: 2, machine: input.cloudId, claim: input.claim, redeem: input.redeem }) };
}

/** redeems a v2 boot file's claim at the account service, writing the v1 boot content root keeps; retried, never on a 403 */
export const REDEEM_SCRIPT = `const fs = require("node:fs");
const b = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (b.v !== 2 || !/^c[0-9a-f]{24}$/.test(b.machine) || typeof b.claim !== "string" || !/^https:\\/\\/[^/]+\\/v1\\/managed\\/claims\\/redeem$/.test(b.redeem)) process.exit(1);
(async () => {
  // the claim lives an hour: keep trying through a slow deploy of the service or its rate limit, never past a refusal
  const until = Date.now() + 55 * 60_000;
  for (let i = 0; Date.now() < until; i++) {
    let wait = Math.min(60000, 3000 * (i + 1));
    try {
      const r = await fetch(b.redeem, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20000), headers: { "content-type": "application/json" }, body: JSON.stringify({ cloud: b.machine, claim: b.claim }) });
      if (r.status === 403) process.exit(1);
      if (r.ok) { const a = await r.json(); if (a.v !== 1 || a.machine !== b.machine) process.exit(1); fs.writeFileSync(process.argv[2], JSON.stringify(a), { mode: 0o600 }); return; }
      const after = Number(r.headers.get("retry-after"));
      if (Number.isFinite(after) && after > 0) wait = Math.min(300000, after * 1000);
    } catch {}
    await new Promise((f) => setTimeout(f, wait));
  }
  process.exit(1);
})();`;

/** the sha256 a home package must have, from DUSK_BOAT_HOME_PACKAGE_SHA256 or the uploaded file */
const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Runs once on the first start. Installs Node and Caddy (pinned, checksummed), the `maus` user, the volume at /data, the
 * systemd units and the helper commands, and moves the boot secrets into root's files. It never starts the home: the
 * reconciler installs the app package and starts it once it knows the sandbox's public origin.
 */
export function boatSetupScript(options: { releaseKeys: readonly ReleaseKey[]; requireSigned: boolean } = { releaseKeys: [], requireSigned: false }): string {
  const node = `node-v${BOAT_NODE.version}-linux-x64`;
  const caddy = `caddy_${BOAT_CADDY.version}_linux_amd64.tar.gz`;
  const unit = `[Unit]
Description=Dusk Bot My Cloud home
After=network-online.target omb-docker-gate.service
Wants=network-online.target
ConditionPathExists=${APP}/dist-server/cloud-home-start.js
# while the provider saves the disk nothing may reopen the databases (omb-home start clears it)
ConditionPathExists=!${PRE_STOP_FLAG}

[Service]
EnvironmentFile=${CLOUD_HOME.etc}/home.env
ExecStart=${BOAT_NODE_BIN} ${APP}/dist-server/cloud-home-start.js
Restart=always
RestartSec=3
KillMode=mixed
TimeoutStopSec=35
# a runaway agent build is killed before the home: the home and its engines stay under 90% of memory, the bot
# computers' containers under omb-bots.slice, and the kernel picks anything else before this unit
MemoryHigh=80%
MemoryMax=90%
OOMScoreAdjust=-500
OOMPolicy=continue

[Install]
WantedBy=multi-user.target
`;
  const gate = `[Unit]
Description=Dusk Bot docker gate for bot computers
After=docker.service
Requires=docker.service
ConditionPathExists=${APP}/link/docker-gate.mjs

[Service]
User=omb-docker
Group=maus
SupplementaryGroups=docker
RuntimeDirectory=${CLOUD_HOME.gate}
RuntimeDirectoryMode=0750
ExecStart=${BOAT_NODE_BIN} ${APP}/link/docker-gate.mjs --listen /run/${CLOUD_HOME.gate}/docker.sock --upstream /var/run/docker.sock
Restart=always
RestartSec=2
UMask=0007
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
RestrictAddressFamilies=AF_UNIX
IPAddressDeny=any

[Install]
WantedBy=multi-user.target
`;
  // Boat runs ~/.boat/pre-stop before every stop it saves (60 s at most): the home closes its databases first. The flag
  // keeps systemd from starting it again during the save; if the provider then cancels the stop, or resumes the machine
  // held in memory with nobody to start it, the timer brings the home back after 15 minutes of uptime.
  const preStop = `#!/bin/bash
sudo -n install -d -o root -g root -m 0755 ${CLOUD_HOME.run}
sudo -n touch ${PRE_STOP_FLAG}
sudo -n systemd-run --quiet --unit=omb-stop-cancelled --on-active=15min --timer-property=AccuracySec=30s ${BOAT_CONTROL} resume-if-cancelled >/dev/null 2>&1 || true
sudo -n timeout 40 systemctl stop omb-home.service >/dev/null 2>&1 || sudo -n systemctl kill -s KILL omb-home.service >/dev/null 2>&1 || true
`;
  // compressed swap at half the memory, so a burst does not kill anything; best effort (some kernels have no zram)
  const zram = `#!/bin/sh
modprobe zram num_devices=1 2>/dev/null || exit 0
[ -b /dev/zram0 ] || exit 0
grep -q /dev/zram0 /proc/swaps && exit 0
echo zstd > /sys/block/zram0/comp_algorithm 2>/dev/null || true
echo "$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 2 ))K" > /sys/block/zram0/disksize
mkswap /dev/zram0 >/dev/null && swapon -p 100 /dev/zram0
`;
  const zramUnit = `[Unit]
Description=Dusk Bot compressed swap

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${BIN}/omb-zram

[Install]
WantedBy=multi-user.target
`;
  const botsSlice = `[Unit]
Description=Dusk bot computers

[Slice]
MemoryHigh=65%
MemoryMax=75%
`;
  const moveBoot = `const fs = require("node:fs");
const boot = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (boot.v !== 1 || !boot.env || !boot.link || !/^c[0-9a-f]{24}$/.test(boot.machine)) process.exit(1);
const env = { ...boot.env, HOME: "/data", DUSK_DATA_DIR: "${CLOUD_HOME.data}", NODE_ENV: "production", DUSK_STATIC_DIR: "${APP}/dist",
  DUSK_CLOUD_EDGE_BIN: "${BIN}/caddy", DUSK_CLOUD_EDGE_CONFIG: "${APP}/cloud/Caddyfile", PATH: "${NODE_DIR}/bin:${BIN}:/usr/local/bin:/usr/bin:/bin",
  DUSK_VPS_DOCKER: "local", DOCKER_HOST: "unix:///run/${CLOUD_HOME.gate}/docker.sock" };
if (Object.entries(env).some(([k, v]) => !/^[A-Z][A-Z0-9_]*$/.test(k) || typeof v !== "string" || /[\\r\\n\\0]/.test(v))) process.exit(1);
fs.writeFileSync("${CLOUD_HOME.etc}/home.env", Object.entries(env).map(([k, v]) => k + "=" + v).join("\\n") + "\\n", { mode: 0o600 });
fs.writeFileSync("${CLOUD_HOME.data}/dashboard-link.json", JSON.stringify(boot.link), { mode: 0o600 });
fs.writeFileSync("${CLOUD_HOME.etc}/machine", boot.machine + "\\n", { mode: 0o600 });
if (!fs.existsSync("/data/${CLOUD_HOME_MARKER_FILE}")) fs.writeFileSync("/data/${CLOUD_HOME_MARKER_FILE}", JSON.stringify({ version: 1, machine: boot.machine }), { mode: 0o600 });`;
  return `#!/bin/bash
set +x
set -euo pipefail
umask 077
export DEBIAN_FRONTEND=noninteractive
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
sudo install -d -o root -g root -m 0755 ${ROOT} ${BIN}
if [ ! -x ${BOAT_NODE_BIN} ] || [ "$(${BOAT_NODE_BIN} --version)" != "v${BOAT_NODE.version}" ]; then
  curl -fsSL --retry 3 -o "$work/node.tar.xz" "https://nodejs.org/dist/v${BOAT_NODE.version}/${node}.tar.xz"
  echo "${BOAT_NODE.sha256}  $work/node.tar.xz" | sha256sum -c --quiet
  tar -xJf "$work/node.tar.xz" -C "$work"
  sudo chown -R root:root "$work/${node}" && sudo chmod -R a+rX,go-w "$work/${node}"
  sudo rm -r -f ${NODE_DIR}.old; [ ! -d ${NODE_DIR} ] || sudo mv ${NODE_DIR} ${NODE_DIR}.old
  sudo mv "$work/${node}" ${NODE_DIR}; sudo rm -r -f ${NODE_DIR}.old
fi
if [ ! -x ${BIN}/caddy ]; then
  curl -fsSL --retry 3 -o "$work/caddy.tar.gz" "https://github.com/caddyserver/caddy/releases/download/v${BOAT_CADDY.version}/${caddy}"
  echo "${BOAT_CADDY.sha512}  $work/caddy.tar.gz" | sha512sum -c --quiet
  tar -xzf "$work/caddy.tar.gz" -C "$work" caddy
  sudo install -o root -g root -m 0755 "$work/caddy" ${BIN}/caddy
fi
# a template already has them: skip the network then
if ! command -v bwrap >/dev/null || ! command -v socat >/dev/null || ! command -v python3 >/dev/null || ! command -v pdftotext >/dev/null || ! command -v unzip >/dev/null; then
  sudo apt-get update -qq >/dev/null 2>&1 || true
  sudo apt-get install -y -qq bubblewrap socat python3 poppler-utils unzip util-linux >/dev/null 2>&1 || true
fi
id maus >/dev/null 2>&1 || sudo useradd --system --home-dir /data --shell /bin/bash --user-group maus
id omb-docker >/dev/null 2>&1 || sudo useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --gid maus omb-docker
getent group docker >/dev/null 2>&1 && sudo usermod -aG docker omb-docker
sudo install -d -o root -g root -m 0700 ${CLOUD_HOME.etc}
sudo install -d -o maus -g maus -m 0700 /data ${CLOUD_HOME.data}
if [ -f ${BOAT_BOOT_FILE} ]; then
  boot=${BOAT_BOOT_FILE}
  if grep -q '"v":2' ${BOAT_BOOT_FILE}; then
    sudo ${BOAT_NODE_BIN} -e ${shellQuote(REDEEM_SCRIPT)} ${BOAT_BOOT_FILE} ${CLOUD_HOME.etc}/boot.json
    boot=${CLOUD_HOME.etc}/boot.json
  fi
  sudo ${BOAT_NODE_BIN} -e ${shellQuote(moveBoot)} "$boot"
  sudo chown maus:maus ${CLOUD_HOME.data}/dashboard-link.json /data/${CLOUD_HOME_MARKER_FILE}
  sudo shred -u ${CLOUD_HOME.etc}/boot.json 2>/dev/null || sudo rm -f ${CLOUD_HOME.etc}/boot.json
  shred -u ${BOAT_BOOT_FILE} 2>/dev/null || rm -f ${BOAT_BOOT_FILE}
fi
sudo install -o root -g root -m 0644 /dev/stdin /etc/systemd/system/omb-home.service <<'DUSK_UNIT'
${unit}DUSK_UNIT
sudo install -o root -g root -m 0644 /dev/stdin /etc/systemd/system/omb-docker-gate.service <<'DUSK_GATE'
${gate}DUSK_GATE
sudo install -o root -g root -m 0755 /dev/stdin ${BOAT_CONTROL} <<'DUSK_CTL'
${boatControlScript(options)}DUSK_CTL
# a machine started from a template runs only the app the template's signature names (a wrong template, not a hostile one)
if [ -d ${APP} ]; then sudo -n ${BOAT_CONTROL} verify-template; fi
install -d -m 0700 /home/user/.boat
install -m 0700 /dev/stdin /home/user/.boat/pre-stop <<'DUSK_PRESTOP'
${preStop}DUSK_PRESTOP
printf '%s\\n' /tmp /var/tmp /var/cache/apt > /home/user/.boatignore
sudo install -o root -g root -m 0755 /dev/stdin ${BIN}/omb-zram <<'DUSK_ZRAM'
${zram}DUSK_ZRAM
sudo install -o root -g root -m 0644 /dev/stdin /etc/systemd/system/omb-zram.service <<'DUSK_ZRAMUNIT'
${zramUnit}DUSK_ZRAMUNIT
sudo install -o root -g root -m 0644 /dev/stdin /etc/systemd/system/omb-bots.slice <<'DUSK_SLICE'
${botsSlice}DUSK_SLICE
sudo systemctl daemon-reload
sudo systemctl enable --now omb-zram.service >/dev/null 2>&1 || true
# bot computers' containers go under omb-bots.slice (merged into any daemon.json there; docker restarts once)
if [ -d /etc/docker ] || command -v dockerd >/dev/null; then
  sudo install -d -m 0755 /etc/docker
  if sudo ${BOAT_NODE_BIN} -e ${shellQuote(DOCKER_SLICE)}; then sudo systemctl restart docker >/dev/null 2>&1 || true; fi
fi
`;
}

/**
 * <root>/bin/omb-home, root's: `install <file> <sha256>`, `restore <tar>`, `start <origin>`, `stop`, `status`. Each
 * prints only fixed words. Running it again is safe.
 */
export function boatControlScript(options: { releaseKeys: readonly ReleaseKey[]; requireSigned: boolean } = { releaseKeys: [], requireSigned: false }): string {
  return `#!/bin/bash
set +x
set -euo pipefail
umask 077
app=${APP}
verify=${shellQuote(machineVerifyScript(options.releaseKeys))}
signed=${options.requireSigned ? 1 : 0}
tree() { (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1); }
case "\${1:-}" in
  install)
    file="$2"; sum="$3"; sig="\${4:-}"
    [[ "$sum" =~ ^[a-f0-9]{64}$ ]] || { echo "bad checksum"; exit 2; }
    echo "$sum  $file" | sha256sum -c --quiet
    if [ -n "$sig" ] || [ "$signed" = 1 ]; then
      [[ "$sig" =~ ^r1\\.[a-z0-9-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$ ]] || { echo "unsigned package"; exit 2; }
      sigfile="$(mktemp)"; printf '%s' "$sig" > "$sigfile"
      ${BOAT_NODE_BIN} -e "$verify" "$sigfile" "$sum" home-package || { rm -f "$sigfile"; echo "bad signature"; exit 2; }
      rm -f "$sigfile"
    fi
    next="$app.next"; rm -rf "$next"; install -d -o root -g root -m 0755 "$next"
    tar -xzf "$file" -C "$next" --no-same-owner --no-same-permissions
    chown -R root:root "$next"; chmod -R go-w,a+rX "$next"
    test -f "$next/dist-server/cloud-home-start.js"
    systemctl stop omb-home.service >/dev/null 2>&1 || true
    rm -rf "$app.prev"; [ ! -d "$app" ] || mv "$app" "$app.prev"; mv "$next" "$app"
    echo "$sum" > ${ROOT}/installed; rm -f "$file"
    echo installed ;;
  restore)
    file="$2"
    systemctl stop omb-home.service >/dev/null 2>&1 || true
    machine="$(cat ${CLOUD_HOME.etc}/machine)"
    stage="$(mktemp -d /var/tmp/omb-restore.XXXXXX)"
    tar -xf "$file" -C "$stage" --numeric-owner --no-same-permissions --delay-directory-restore
    marker="$(find "$stage" -maxdepth 3 -name .omb-cloud-home.json -type f | head -n 1)"
    [ -n "$marker" ] || { rm -rf "$stage"; echo "not a home backup"; exit 2; }
    grep -q "\\"$machine\\"" "$marker" || { rm -rf "$stage"; echo "another cloud's backup"; exit 2; }
    root="$(dirname "$marker")"
    link="$(mktemp)"; cp ${CLOUD_HOME.data}/dashboard-link.json "$link"
    rm -rf /data.old; mv /data /data.old; mv "$root" /data
    install -d -o maus -g maus -m 0700 ${CLOUD_HOME.data}
    install -o maus -g maus -m 0600 "$link" ${CLOUD_HOME.data}/dashboard-link.json
    chown -R maus:maus /data; chmod 0700 /data; rm -rf "$stage" "$link" "$file" /data.old
    echo restored ;;
  verify-template)
    # the template's signature names the tree hash of the app it carries; anything else never starts
    [ -f ${ROOT}/template.sig ] || { [ "$signed" = 1 ] && { echo "unsigned template"; exit 2; }; echo "no template signature"; exit 0; }
    ${BOAT_NODE_BIN} -e "$verify" ${ROOT}/template.sig "$(tree "$app")" template || { echo "bad template"; exit 2; }
    echo verified ;;
  tree) tree "$app" ;;
  resume-if-cancelled)
    # the stop this flag guarded never came (cancelled, or a resume that kept the machine in memory): start again
    if [ -f ${PRE_STOP_FLAG} ] && [ $(( $(date +%s) - $(stat -c %Y ${PRE_STOP_FLAG}) )) -ge 300 ]; then
      rm -f ${PRE_STOP_FLAG}; systemctl start omb-home.service; echo resumed
    else echo kept; fi ;;
  start)
    origin="$2"; upstream="\${3:-$2}"
    [[ "$origin" =~ ^https://[a-z0-9.-]+$ ]] || { echo "bad origin"; exit 2; }
    [[ "$upstream" =~ ^https://[a-z0-9.-]+$ ]] || { echo "bad origin"; exit 2; }
    sed -i "/^DUSK_PUBLIC_URL=/d; /^DUSK_CLOUD_UPSTREAM_HOST=/d" ${CLOUD_HOME.etc}/home.env
    echo "DUSK_PUBLIC_URL=$origin" >> ${CLOUD_HOME.etc}/home.env
    echo "DUSK_CLOUD_UPSTREAM_HOST=\${upstream#https://}" >> ${CLOUD_HOME.etc}/home.env
    rm -f ${PRE_STOP_FLAG}; systemctl stop omb-stop-cancelled.timer >/dev/null 2>&1 || true
    systemctl enable omb-home.service >/dev/null 2>&1
    if [ -S /var/run/docker.sock ] && [ -f "$app/link/docker-gate.mjs" ]; then systemctl enable --now omb-docker-gate.service >/dev/null 2>&1 || true; fi
    systemctl restart omb-home.service
    for i in $(seq 1 60); do curl -fsS -m 2 http://127.0.0.1:8799/api/health >/dev/null 2>&1 && { echo started; exit 0; }; sleep 1; done
    echo "not answering"; exit 3 ;;
  stop) systemctl stop omb-home.service; echo stopped ;;
  status) systemctl is-active omb-home.service || true; [ -f ${ROOT}/installed ] && cat ${ROOT}/installed || echo none ;;
  *) echo "usage: omb-home install|restore|start|stop|status|verify-template|tree|resume-if-cancelled"; exit 2 ;;
esac
`;
}

export function installCommand(sha256: string, url?: string, signature?: string): string {
  if (!SHA256.test(sha256)) throw new Error("Invalid home package checksum.");
  if (signature !== undefined && !/^r1\.[a-z0-9-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(signature)) throw new Error("Invalid home package signature.");
  const install = `sudo -n ${BOAT_CONTROL} install ${BOAT_PACKAGE_FILE} ${sha256}${signature ? ` ${signature}` : ""}`;
  if (url === undefined) return install;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Invalid home package URL.");
  return `curl -fsSL --retry 3 -o ${BOAT_PACKAGE_FILE} ${shellQuote(parsed.href)} && ${install}`;
}
/** `origin`: what people use (ours, through the edge); `upstream`: the machine's own hosted URL, which the edge forwards to */
export function startCommand(origin: string, upstream: string = origin): string {
  for (const value of [origin, upstream]) {
    const url = new URL(value);
    if (url.origin !== value || url.protocol !== "https:") throw new Error("Invalid cloud origin.");
  }
  return `sudo -n ${BOAT_CONTROL} start ${shellQuote(origin)} ${shellQuote(upstream)}`;
}
export const RESTORE_COMMAND = `sudo -n ${BOAT_CONTROL} restore ${BOAT_RESTORE_FILE}`;
export const STATUS_COMMAND = "sudo -n ${BOAT_CONTROL} status";

/** the key a cloud's backups are sealed with, derived from its bootstrap secret, so nothing else needs storing */
export function backupKey(secret: string): Buffer { return createHmac("sha256", secret).update("omb-boat-backup-v1").digest(); }

export const BOAT_IMAGE: MachineImage = {
  homeVolume: BOAT_HOME_VOLUME, packagePath: BOAT_PACKAGE_FILE, restorePath: BOAT_RESTORE_FILE,
  bootFile: boatBootFile, claimBootFile, bootContent, setupScript: boatSetupScript,
  installCommand, startCommand, restoreCommand: RESTORE_COMMAND, legacyBackupKey: backupKey,
};
