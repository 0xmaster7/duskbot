// CI builds one pre-baked template per release: a builder machine runs the same setup as every home, installs the
// signed home package (the machine checks its signature), and is saved as a named snapshot. A new home starts from it in
// seconds, with Node, Caddy, the system packages and the app already there; the app never ran on the builder, so no
// identity, claim or data is in it. The template is signed (its app's tree hash) and every machine checks that before it
// starts. The three newest templates are kept, plus the one the service uses now.
//
//   BOAT_TEMPLATE_API_KEY=... BOAT_BASE_URL=... DUSK_RELEASE_SIGNING_KEY=... \
//   node apps/cloud-service/scripts/build-template.ts --package release/home/omb-home.tgz --signature release/home/omb-home.tgz.sig --version 0.1.150 [--in-use omb-home-0-1-149]
import { CLOUD_HOME } from "../../../electron/legacy-names.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createBoatProvider, type BoatProvider } from "../src/boat.ts";
import { BOAT_CONTROL, BOAT_PACKAGE_FILE, boatSetupScript, installCommand } from "../src/home.ts";
import { parseReleaseKeys, PINNED_RELEASE_KEYS, signRelease, verifyRelease } from "../src/release-signing.ts";

const PREFIX = "omb-home-";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface TemplateBuild {
  provider: BoatProvider;
  /** the package's bytes, its release signature and version */
  pkg: Buffer;
  signature: string;
  version: string;
  signingKey: string;
  releaseKeys: ReturnType<typeof parseReleaseKeys>;
  /** templates the service uses now: never removed */
  inUse?: string[];
  keep?: number;
  pollMs?: number;
  log?: (line: string) => void;
}

export function templateName(version: string): string {
  const name = `${PREFIX}${version.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new Error("Invalid template version.");
  return name;
}

export async function buildTemplate(input: TemplateBuild): Promise<{ name: string; signature: string; tree: string }> {
  const { provider } = input, log = input.log ?? (() => {}), poll = input.pollMs ?? 5_000;
  const sha256 = createHash("sha256").update(input.pkg).digest("hex");
  verifyRelease(input.signature, { kind: "home-package", sha256 }, input.releaseKeys);
  const name = templateName(input.version);
  const existing = await provider.namedSnapshot(name);
  if (existing) throw new Error(`${name} exists already; a release never replaces a template homes may start from.`);
  // a builder belongs to no cloud: its own id, never a cloud's, and its own short lease
  const builder = await provider.create({ cloudId: `c${createHash("sha256").update(`template:${name}`).digest("hex").slice(0, 24)}`, spec: { vcpu: 2, ramGb: 4, diskGb: 40 }, region: "",
    userData: boatSetupScript({ releaseKeys: input.releaseKeys, requireSigned: true }), ttlSeconds: 2 * 3600, attempt: Date.now() });
  log(`builder ${builder.id}`);
  try {
    for (let n = 0; ; n++) {
      const s = await provider.sandbox(builder.id);
      if (s && ["ready", "idle", "running"].includes(s.state) && (s.setup === "done" || s.setup === null)) break;
      if (s?.setup === "failed") throw new Error("The builder's setup failed.");
      if (n > 180) throw new Error("The builder was not ready in time.");
      await sleep(poll);
    }
    await provider.upload(builder.id, BOAT_PACKAGE_FILE, input.pkg);
    const installed = await provider.run(builder.id, installCommand(sha256, undefined, input.signature), 600);
    if (!installed.ok || !installed.stdout.includes("installed")) throw new Error("The package did not install on the builder.");
    // the app never ran here: no env, no machine id, no data
    const clean = await provider.run(builder.id, `sudo -n test ! -e ${CLOUD_HOME.etc}/home.env && sudo -n test ! -e ${CLOUD_HOME.etc}/machine && sudo -n test -z "$(sudo -n ls -A ${CLOUD_HOME.data} 2>/dev/null)" && echo clean`, 60);
    if (!clean.stdout.includes("clean")) throw new Error("The builder is not clean; nothing was saved.");
    const tree = (await provider.run(builder.id, `sudo -n ${BOAT_CONTROL} tree`, 300)).stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(tree)) throw new Error("The builder's app could not be hashed.");
    const signature = signRelease({ kind: "template", name, version: sha256, sha256: tree, signedAt: Date.now() }, input.signingKey);
    verifyRelease(signature, { kind: "template", name, sha256: tree }, input.releaseKeys);
    await provider.upload(builder.id, "/home/user/template.sig", Buffer.from(signature));
    const placed = await provider.run(builder.id, `sudo -n install -o root -g root -m 0644 /home/user/template.sig ${CLOUD_HOME.root}/template.sig && rm -f /home/user/template.sig && echo placed`, 60);
    if (!placed.stdout.includes("placed")) throw new Error("The template signature was not placed.");
    await provider.saveNamedSnapshot(builder.id, name);
    for (let n = 0; ; n++) {
      const snapshot = await provider.namedSnapshot(name);
      if (snapshot?.status === "ready") break;
      if (snapshot?.status === "failed") throw new Error(`${name} failed to save; inspect it before retrying (it was not replaced).`);
      if (n > 360) throw new Error(`${name} did not become ready in time.`);
      await sleep(poll);
    }
    log(`saved ${name}`);
    const keep = new Set([name, ...(input.inUse ?? [])]);
    const ours = (await provider.namedSnapshots()).filter(x => x.name.startsWith(PREFIX) && x.status === "ready").sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    for (const old of ours.slice(input.keep ?? 3)) if (!keep.has(old.name)) { await provider.deleteNamedSnapshot(old.name); log(`removed ${old.name}`); }
    return { name, signature, tree };
  } finally {
    await provider.requestDelete(builder.id).catch(() => log(`the builder ${builder.id} was not deleted; delete it by hand`));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { package: { type: "string" }, signature: { type: "string" }, version: { type: "string" }, "in-use": { type: "string", multiple: true } } });
  // the template key, never the runtime key: only CI holds it
  const key = process.env.BOAT_TEMPLATE_API_KEY, signingKey = process.env.DUSK_RELEASE_SIGNING_KEY;
  if (!key || !signingKey || !values.package || !values.signature || !values.version) {
    console.error("usage: BOAT_TEMPLATE_API_KEY=... DUSK_RELEASE_SIGNING_KEY=... build-template.ts --package <tgz> --signature <sig file> --version <v> [--in-use <name>]");
    process.exit(2);
  }
  const provider = createBoatProvider({ apiKey: key, baseUrl: process.env.BOAT_BASE_URL, scope: createHash("sha256").update("omb-template").digest("hex").slice(0, 16) });
  const built = await buildTemplate({ provider, pkg: readFileSync(values.package), signature: readFileSync(values.signature, "utf8").trim(), version: values.version, signingKey,
    releaseKeys: [...PINNED_RELEASE_KEYS, ...parseReleaseKeys(process.env.DUSK_RELEASE_PUBLIC_KEYS)], inUse: values["in-use"], log: line => console.log(line) });
  console.log(`DUSK_MANAGED_TEMPLATE=${built.name}\nOMB_MANAGED_TEMPLATE_SIGNATURE=${built.signature}`);
}
