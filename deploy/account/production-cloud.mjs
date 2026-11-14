#!/usr/bin/env node
// Prepares dusk cloud for an account service (production first, preview for its home package): the dusk.env names it
// needs, and a signed home package on the VPS. Dry run unless --apply; idempotent (only what is missing or different is
// written); prints names, paths and sha256s, never a secret's value.
//
//   node deploy/account/production-cloud.mjs env [--apply]                         the [production] names below
//   node deploy/account/production-cloud.mjs package <preview|production> [--apply] release/home/omb-home.tgz(.sig), as built and
//                                                                                signed, uploaded under its version and named in dusk.env
// The deploys themselves are in deploy/account/PRODUCTION-CLOUD.md.
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = process.env.DUSK_ENV || join(homedir(), ".config/duskbot/dusk.env");
const [step, ...rest] = process.argv.slice(2);
const apply = rest.includes("--apply");
const say = (line) => console.log(`${apply ? "" : "[dry run] "}${line}`);
const fail = (line) => { console.error(`production-cloud: ${line}`); process.exit(1); };
const secret = () => randomBytes(32).toString("base64url");

function readEnv() {
  if ((statSync(source).mode & 0o777) !== 0o600) fail(`${source} must be mode 600`);
  const lines = readFileSync(source, "utf8").split("\n");
  const names = new Map(lines.map((line, i) => [/^([A-Z0-9_]+)=/.exec(line)?.[1], i]).filter(([name]) => name));
  return { lines, names };
}
/** sets NAME=value at the end of `section` (before the next section header): new names are added, `replace` ones changed */
function setNames(section, wanted, { replace = [] } = {}) {
  const { lines, names } = readEnv();
  const changes = [];
  for (const [name, value] of wanted) {
    if (names.has(name) && !replace.includes(name)) { say(`${name}: already set, kept`); continue; }
    if (names.has(name) && lines[names.get(name)] === `${name}=${value}`) { say(`${name}: unchanged`); continue; }
    changes.push([name, value]);
    say(`${name}: ${names.has(name) ? "would change" : "would add"}${apply ? " (done)" : ""}`);
  }
  if (!apply || !changes.length) return;
  // the rollback for this step: cp -p <backup> dusk.env
  const backup = `${source}.bak-production-cloud-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(source, backup); chmodSync(backup, 0o600);
  console.log(`backup: ${backup}`);
  for (const [name, value] of changes) {
    if (names.has(name)) { lines[names.get(name)] = `${name}=${value}`; continue; }
    const head = lines.findIndex((line) => line.startsWith(`# [${section}]`));
    if (head < 0) fail(`no [${section}] section in ${source}`);
    let end = lines.findIndex((line, i) => i > head && /^#\s*\[[a-z]+\]/.test(line));
    if (end < 0) end = lines.length;
    while (end > head + 1 && lines[end - 1].trim() === "") end--;
    lines.splice(end, 0, `${name}=${value}`);
    names.clear(); lines.forEach((line, i) => { const n = /^([A-Z0-9_]+)=/.exec(line)?.[1]; if (n) names.set(n, i); });
  }
  writeFileSync(source, lines.join("\n"), { mode: 0o600 });
}

if (step === "env") {
  // billing stays off on production (nothing for sale before launch); App Review's cloud comes from its review grant.
  // the edge token is shared with preview's, so the one edge Worker (ROUTE_URL lists both services) needs no new secret
  setNames("production", [
    ["DUSK_MANAGED_PRODUCTION", "1"],
    ["INSTABOX_API_KEY_PRODUCTION", "${INSTABOX_API_KEY_PREVIEW}"],
    ["DUSK_MANAGED_PROVIDER_PLAN_PRODUCTION", "${DUSK_MANAGED_PROVIDER_PLAN_PREVIEW}"],
    ["DUSK_MANAGED_PUBLIC_DOMAIN_PRODUCTION", "dusk.bot"],
    ["DUSK_MANAGED_EDGE_TOKEN_PRODUCTION", "${DUSK_MANAGED_EDGE_TOKEN_PREVIEW}"],
    ["DUSK_CLOUD_SEAL_KEY_PRODUCTION", secret()],
    ["DUSK_OPS_TOKEN_PRODUCTION", secret()],
  ]);
  // the env file production would get must still build (references resolve, names end in _PRODUCTION)
  const probe = join(mkdtempSync(join(tmpdir(), "dusk-env-")), "env");
  try { execFileSync("node", [join(root, "deploy/env.mjs"), "production", probe], { stdio: "inherit" }); say(`production env builds (${readFileSync(probe, "utf8").split("\n").filter(Boolean).length} names)`); }
  finally { rmSync(dirname(probe), { recursive: true, force: true }); }
} else if (step === "package") {
  const target = rest.find((arg) => arg === "preview" || arg === "production") ?? fail("package needs preview or production");
  const tgz = join(root, "release/home/omb-home.tgz"), sig = `${tgz}.sig`;
  if (!existsSync(tgz) || !existsSync(sig)) fail("build and sign it first: node apps/cloud-service/scripts/build-home-package.mjs, then sign-release.ts (PRODUCTION-CLOUD.md)");
  const sha = createHash("sha256").update(readFileSync(tgz)).digest("hex");
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const dir = target === "production" ? "/var/lib/dusk-account-prod/home" : "/var/lib/dusk-account-preview/home";
  const remote = `${dir}/omb-home-${version}.tgz`, suffix = target.toUpperCase();
  const there = execFileSync("ssh", ["-o", "BatchMode=yes", "contabo", `sha256sum ${remote} 2>/dev/null | cut -c1-64; test -f ${remote}.sig && echo sig; true`], { encoding: "utf8" }).split("\n");
  if (there[0] === sha && there[1] === "sig") say(`${remote}: already there (sha256 ${sha.slice(0, 12)}...)`);
  else {
    say(`${remote}(.sig): would upload version ${version}, sha256 ${sha.slice(0, 12)}...`);
    if (apply) {
      execFileSync("ssh", ["-o", "BatchMode=yes", "contabo", `mkdir -p ${dir}`]);
      execFileSync("scp", ["-q", tgz, `contabo:${remote}`]); execFileSync("scp", ["-q", sig, `contabo:${remote}.sig`]);
      const check = execFileSync("ssh", ["-o", "BatchMode=yes", "contabo", `sha256sum ${remote} | cut -c1-64`], { encoding: "utf8" }).trim();
      if (check !== sha) fail(`the uploaded package's sha256 differs (${check.slice(0, 12)}...)`);
    }
  }
  setNames(target, [[`DUSK_MANAGED_HOME_PACKAGE_FILE_${suffix}`, remote], [`DUSK_MANAGED_HOME_PACKAGE_SIGNATURE_FILE_${suffix}`, `${remote}.sig`], [`DUSK_MANAGED_HOME_PACKAGE_SHA256_${suffix}`, sha]],
    { replace: [`DUSK_MANAGED_HOME_PACKAGE_FILE_${suffix}`, `DUSK_MANAGED_HOME_PACKAGE_SIGNATURE_FILE_${suffix}`, `DUSK_MANAGED_HOME_PACKAGE_SHA256_${suffix}`] });
  say(`then: deploy/account/deploy.sh ${target} (homes take the newer package when idle)`);
} else {
  console.error("usage: production-cloud.mjs env [--apply] | package <preview|production> [--apply]");
  process.exit(2);
}
