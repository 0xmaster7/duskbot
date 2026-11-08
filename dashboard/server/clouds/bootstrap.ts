import { generateKeyPairSync } from "node:crypto";

export interface DashboardLink {
  v: 1;
  url: string;
  workspaceId: string;
  publicKey: string;
  privateKey: string;
  enrolledAt: number;
  claimed: boolean;
}
interface HomeInput { cloudId: string; adminOrigin: string; secret: string; origin: string; dashboardUrl: string }
interface BootstrapInput extends Omit<HomeInput, "origin"> { link: DashboardLink }

export function linkKeys(): { publicKey: string; privateKey: string } {
  const keys = generateKeyPairSync("ed25519");
  return { publicKey: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64"), privateKey: keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") };
}

export function homeEnv(input: HomeInput): Record<string, string> {
  return { OMB_CLOUD_ROLE: "home", OMB_CLOUD_MACHINE_ID: input.cloudId, OMB_CLOUD_ADMIN_URL: input.adminOrigin, OMB_CLOUD_BOOTSTRAP_SECRET: input.secret, OMB_PUBLIC_URL: input.origin, OMB_DASHBOARD_URL: input.dashboardUrl };
}

export function originFor(template: string | undefined, input: { ipv4: string; cloudId: string }): string {
  if (!/^c[0-9a-f]{24}$/.test(input.cloudId) || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(input.ipv4) || input.ipv4.split(".").some(v => Number(v) > 255)) throw new Error("Invalid cloud address.");
  const origin = (template ?? "https://{ip-dashed}.sslip.io").replaceAll("{ip-dashed}", input.ipv4.replaceAll(".", "-")).replaceAll("{id}", input.cloudId);
  try {
    const url = new URL(origin);
    if (origin !== url.origin || url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) throw new Error();
    return origin;
  } catch { throw new Error("Invalid cloud origin template."); }
}

export function poolBootstrap(input: BootstrapInput & { origin: string }): string {
  return JSON.stringify({ env: { ...homeEnv(input), HOME: "/data", OMB_DATA_DIR: "/data/.openmausbot", OMB_PORT: "8799" }, files: [{ path: "/data/.openmausbot/dashboard-link.json", mode: 0o600, content: JSON.stringify(input.link) }] });
}

export function shellQuote(value: string): string { return `'${value.replaceAll("'", `'"'"'`)}'`; }

export function dedicatedUserData(input: BootstrapInput & { version: string; originTemplate?: string }): string {
  const unit = `[Unit]\nDescription=OpenMausBot Cloud home\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nUser=maus\nWorkingDirectory=/home/maus\nEnvironmentFile=/home/maus/cloud.env\nExecStart=/home/maus/.local/bin/openmausbot serve --no-pair\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target\n`;
  const setup = `const fs = require("node:fs");
const input = JSON.parse(process.argv[1]);
const ipv4 = process.argv[2].trim();
if (!/^(?:\\d{1,3}\\.){3}\\d{1,3}$/.test(ipv4) || ipv4.split(".").some(v => Number(v) > 255)) process.exit(1);
const origin = input.template.replaceAll("{ip-dashed}", ipv4.replaceAll(".", "-")).replaceAll("{id}", input.cloudId);
const url = new URL(origin);
if (origin !== url.origin || url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password) process.exit(1);
const env = { ...input.env, OMB_PUBLIC_URL: origin, HOME: "/home/maus", OMB_DATA_DIR: "/home/maus/.openmausbot", OMB_PORT: "8799", PATH: "/home/maus/.local/bin:/usr/local/bin:/usr/bin:/bin", NODE_ENV: "production" };
const quoted = v => '"' + v.replaceAll('\\\\', '\\\\\\\\').replaceAll('"', '\\\\"').replaceAll('\\n', '\\\\n').replaceAll('\\r', '\\\\r') + '"';
fs.writeFileSync("/home/maus/cloud.env", Object.entries(env).map(([k,v]) => k + "=" + quoted(v)).join("\\n") + "\\n", { mode: 0o600 });
fs.writeFileSync("/home/maus/.openmausbot/dashboard-link.json", JSON.stringify(input.link), { mode: 0o600 });
fs.writeFileSync("/etc/caddy/Caddyfile", url.host + " {\\n reverse_proxy 127.0.0.1:8799\\n}\\n");`;
  const payload = { cloudId: input.cloudId, template: input.originTemplate ?? "https://{ip-dashed}.sslip.io", env: homeEnv({ ...input, origin: "" }), link: input.link };
  return `#!/bin/bash
set -euo pipefail
umask 077
useradd --create-home --home-dir /home/maus --shell /bin/bash maus
apt-get update
apt-get install -y ca-certificates curl gnupg caddy
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
install -d -m 700 -o maus -g maus /home/maus/.openmausbot /home/maus/.local
runuser -u maus -- env HOME=/home/maus npm install --global --prefix /home/maus/.local ${shellQuote(`openmausbot@${input.version}`)}
ipv4="$(curl -fsS --max-time 10 http://169.254.169.254/hetzner/v1/metadata/public-ipv4)"
node -e ${shellQuote(setup)} ${shellQuote(JSON.stringify(payload))} "$ipv4"
chown maus:maus /home/maus/cloud.env /home/maus/.openmausbot/dashboard-link.json
chmod 644 /etc/caddy/Caddyfile
printf '%s' ${shellQuote(unit)} > /etc/systemd/system/openmausbot.service
systemctl daemon-reload
systemctl enable --now openmausbot
systemctl enable caddy
systemctl restart caddy
`;
}
