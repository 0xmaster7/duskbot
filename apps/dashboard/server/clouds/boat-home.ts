// What runs on a Boat sandbox to make it a My Cloud home: the same launcher, edge and server as every Cloud home
// (server/cloud-home-start.ts, deploy/boat/Caddyfile), installed natively under systemd so it comes back after every resume.
// Boat runs the setup script once, as `user` with passwordless sudo; every later step is one command the reconciler sends.
import { createHmac } from "node:crypto";
import { CLOUD_HOME_MARKER_FILE, homeEnv, shellQuote, type DashboardLink } from "./bootstrap.ts";

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
const ROOT = "/usr/lib/openmausbot", APP = `${ROOT}/app`, BIN = `${ROOT}/bin`, NODE_DIR = `${ROOT}/node`;
export const BOAT_NODE_BIN = `${NODE_DIR}/bin/node`;
export const BOAT_CONTROL = `${BIN}/omb-home`;

export interface BoatBootInput { cloudId: string; adminOrigin: string; secret: string; dashboardUrl: string; link: DashboardLink }

/** the per-cloud secrets as one file for Boat's create `files` (it never appears in a script, a command or a log) */
export function boatBootFile(input: BoatBootInput): { path: string; content: string } {
  const env = { ...homeEnv({ ...input, origin: "https://pending.invalid" }), OMB_CLOUD_EDGE_HOLD: "30s" };
  return { path: BOAT_BOOT_FILE, content: JSON.stringify({ v: 1, env, link: input.link, machine: input.cloudId }) };
}

/** the sha256 a home package must have, from OMB_BOAT_HOME_PACKAGE_SHA256 or the uploaded file */
const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Runs once on the first start. Installs Node and Caddy (pinned, checksummed), the `maus` user, the volume at /data, the
 * systemd units and the helper commands, and moves the boot secrets into root's files. It never starts the home: the
 * reconciler installs the app package and starts it once it knows the sandbox's public origin.
 */
export function boatSetupScript(): string {
  const node = `node-v${BOAT_NODE.version}-linux-x64`;
  const caddy = `caddy_${BOAT_CADDY.version}_linux_amd64.tar.gz`;
  const unit = `[Unit]
Description=OpenMausBot My Cloud home
After=network-online.target omb-docker-gate.service
Wants=network-online.target
ConditionPathExists=${APP}/dist-server/cloud-home-start.js

[Service]
EnvironmentFile=/etc/openmausbot/home.env
ExecStart=${BOAT_NODE_BIN} ${APP}/dist-server/cloud-home-start.js
Restart=always
RestartSec=3
KillMode=mixed
TimeoutStopSec=45

[Install]
WantedBy=multi-user.target
`;
  const gate = `[Unit]
Description=OpenMausBot docker gate for bot computers
After=docker.service
Requires=docker.service
ConditionPathExists=${APP}/link/docker-gate.mjs

[Service]
User=omb-docker
Group=maus
SupplementaryGroups=docker
RuntimeDirectory=openmausbot-docker
RuntimeDirectoryMode=0750
ExecStart=${BOAT_NODE_BIN} ${APP}/link/docker-gate.mjs --listen /run/openmausbot-docker/docker.sock --upstream /var/run/docker.sock
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
  // Boat runs ~/.boat/pre-stop before every stop it saves (60 s at most): the home closes its databases first
  const preStop = `#!/bin/bash
sudo -n systemctl stop omb-home.service >/dev/null 2>&1 || true
`;
  const moveBoot = `const fs = require("node:fs");
const boot = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (boot.v !== 1 || !boot.env || !boot.link || !/^c[0-9a-f]{24}$/.test(boot.machine)) process.exit(1);
const env = { ...boot.env, HOME: "/data", OMB_DATA_DIR: "/data/.openmausbot", NODE_ENV: "production", OMB_STATIC_DIR: "${APP}/dist",
  OMB_CLOUD_EDGE_BIN: "${BIN}/caddy", OMB_CLOUD_EDGE_CONFIG: "${APP}/cloud/Caddyfile", PATH: "${NODE_DIR}/bin:${BIN}:/usr/local/bin:/usr/bin:/bin",
  OPENMAUSBOT_VPS_DOCKER: "local", DOCKER_HOST: "unix:///run/openmausbot-docker/docker.sock" };
if (Object.entries(env).some(([k, v]) => !/^[A-Z][A-Z0-9_]*$/.test(k) || typeof v !== "string" || /[\\r\\n\\0]/.test(v))) process.exit(1);
fs.writeFileSync("/etc/openmausbot/home.env", Object.entries(env).map(([k, v]) => k + "=" + v).join("\\n") + "\\n", { mode: 0o600 });
fs.writeFileSync("/data/.openmausbot/dashboard-link.json", JSON.stringify(boot.link), { mode: 0o600 });
fs.writeFileSync("/etc/openmausbot/machine", boot.machine + "\\n", { mode: 0o600 });
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
sudo apt-get update -qq >/dev/null 2>&1 || true
sudo apt-get install -y -qq bubblewrap socat python3 poppler-utils unzip util-linux >/dev/null 2>&1 || true
id maus >/dev/null 2>&1 || sudo useradd --system --home-dir /data --shell /bin/bash --user-group maus
id omb-docker >/dev/null 2>&1 || sudo useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --gid maus omb-docker
getent group docker >/dev/null 2>&1 && sudo usermod -aG docker omb-docker
sudo install -d -o root -g root -m 0700 /etc/openmausbot
sudo install -d -o maus -g maus -m 0700 /data /data/.openmausbot
if [ -f ${BOAT_BOOT_FILE} ]; then
  sudo ${BOAT_NODE_BIN} -e ${shellQuote(moveBoot)} ${BOAT_BOOT_FILE}
  sudo chown maus:maus /data/.openmausbot/dashboard-link.json /data/${CLOUD_HOME_MARKER_FILE}
  shred -u ${BOAT_BOOT_FILE} 2>/dev/null || rm -f ${BOAT_BOOT_FILE}
fi
sudo install -o root -g root -m 0644 /dev/stdin /etc/systemd/system/omb-home.service <<'OMB_UNIT'
${unit}OMB_UNIT
sudo install -o root -g root -m 0644 /dev/stdin /etc/systemd/system/omb-docker-gate.service <<'OMB_GATE'
${gate}OMB_GATE
sudo install -o root -g root -m 0755 /dev/stdin ${BOAT_CONTROL} <<'OMB_CTL'
${boatControlScript()}OMB_CTL
install -d -m 0700 /home/user/.boat
install -m 0700 /dev/stdin /home/user/.boat/pre-stop <<'OMB_PRESTOP'
${preStop}OMB_PRESTOP
printf '%s\\n' /tmp /var/tmp /var/cache/apt > /home/user/.boatignore
sudo systemctl daemon-reload
`;
}

/**
 * /usr/lib/openmausbot/bin/omb-home, root's: `install <file> <sha256>`, `restore <tar>`, `start <origin>`, `stop`, `status`. Each
 * prints only fixed words. Running it again is safe.
 */
export function boatControlScript(): string {
  return `#!/bin/bash
set +x
set -euo pipefail
umask 077
app=${APP}
case "\${1:-}" in
  install)
    file="$2"; sum="$3"
    [[ "$sum" =~ ^[a-f0-9]{64}$ ]] || { echo "bad checksum"; exit 2; }
    echo "$sum  $file" | sha256sum -c --quiet
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
    machine="$(cat /etc/openmausbot/machine)"
    stage="$(mktemp -d /var/tmp/omb-restore.XXXXXX)"
    tar -xf "$file" -C "$stage" --numeric-owner --no-same-permissions --delay-directory-restore
    marker="$(find "$stage" -maxdepth 3 -name .omb-cloud-home.json -type f | head -n 1)"
    [ -n "$marker" ] || { rm -rf "$stage"; echo "not a home backup"; exit 2; }
    grep -q "\\"$machine\\"" "$marker" || { rm -rf "$stage"; echo "another cloud's backup"; exit 2; }
    root="$(dirname "$marker")"
    link="$(mktemp)"; cp /data/.openmausbot/dashboard-link.json "$link"
    rm -rf /data.old; mv /data /data.old; mv "$root" /data
    install -d -o maus -g maus -m 0700 /data/.openmausbot
    install -o maus -g maus -m 0600 "$link" /data/.openmausbot/dashboard-link.json
    chown -R maus:maus /data; chmod 0700 /data; rm -rf "$stage" "$link" "$file" /data.old
    echo restored ;;
  start)
    origin="$2"
    [[ "$origin" =~ ^https://[a-z0-9.-]+$ ]] || { echo "bad origin"; exit 2; }
    sed -i "/^OMB_PUBLIC_URL=/d" /etc/openmausbot/home.env
    echo "OMB_PUBLIC_URL=$origin" >> /etc/openmausbot/home.env
    systemctl enable omb-home.service >/dev/null 2>&1
    if [ -S /var/run/docker.sock ] && [ -f "$app/link/docker-gate.mjs" ]; then systemctl enable --now omb-docker-gate.service >/dev/null 2>&1 || true; fi
    systemctl restart omb-home.service
    for i in $(seq 1 60); do curl -fsS -m 2 http://127.0.0.1:8799/api/health >/dev/null 2>&1 && { echo started; exit 0; }; sleep 1; done
    echo "not answering"; exit 3 ;;
  stop) systemctl stop omb-home.service; echo stopped ;;
  status) systemctl is-active omb-home.service || true; [ -f ${ROOT}/installed ] && cat ${ROOT}/installed || echo none ;;
  *) echo "usage: omb-home install|restore|start|stop|status"; exit 2 ;;
esac
`;
}

export function installCommand(sha256: string, url?: string): string {
  if (!SHA256.test(sha256)) throw new Error("Invalid home package checksum.");
  if (url === undefined) return `sudo -n ${BOAT_CONTROL} install ${BOAT_PACKAGE_FILE} ${sha256}`;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Invalid home package URL.");
  return `curl -fsSL --retry 3 -o ${BOAT_PACKAGE_FILE} ${shellQuote(parsed.href)} && sudo -n ${BOAT_CONTROL} install ${BOAT_PACKAGE_FILE} ${sha256}`;
}
export function startCommand(origin: string): string {
  const url = new URL(origin);
  if (url.origin !== origin || url.protocol !== "https:") throw new Error("Invalid cloud origin.");
  return `sudo -n ${BOAT_CONTROL} start ${shellQuote(origin)}`;
}
export const RESTORE_COMMAND = `sudo -n ${BOAT_CONTROL} restore ${BOAT_RESTORE_FILE}`;
export const STATUS_COMMAND = "sudo -n ${BOAT_CONTROL} status";

/** the key a cloud's backups are sealed with, derived from its bootstrap secret, so nothing else needs storing */
export function backupKey(secret: string): Buffer { return createHmac("sha256", secret).update("omb-boat-backup-v1").digest(); }
