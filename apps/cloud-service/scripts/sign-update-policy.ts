// CI (or the operator, with the release key) signs the update policy: the floor no install may run below and the
// versions pulled. The account service serves the file it is given as DUSK_UPDATE_POLICY_FILE at /v1/updates/policy and
// reads it again when it changes; the VPS link service hands the same file to installs (<data>/packages/update-policy.json).
// The serial must grow with each new policy: an install never takes one older than the one it holds.
//
//   DUSK_RELEASE_SIGNING_KEY=... node apps/cloud-service/scripts/sign-update-policy.ts --serial 7 --floor 0.1.150 --block 0.1.152,0.1.153 --out update-policy.json
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseReleaseKeys, PINNED_RELEASE_KEYS } from "../src/release-signing.ts";
import { signPolicy, verifyPolicy } from "../src/update-policy.ts";

const { values } = parseArgs({ options: { serial: { type: "string" }, floor: { type: "string" }, block: { type: "string" }, out: { type: "string" } } });
const key = process.env.DUSK_RELEASE_SIGNING_KEY;
if (!key || !values.serial || !values.out) {
  console.error("usage: DUSK_RELEASE_SIGNING_KEY=... sign-update-policy.ts --serial <n> [--floor <x.y.z>] [--block <a,b>] --out <file>");
  process.exit(2);
}
const policy = { serial: Number(values.serial), floor: values.floor ?? null, blocked: values.block ? values.block.split(",").map(v => v.trim()).filter(Boolean) : [] };
const signed = signPolicy(policy, key);
// a key nothing pins would sign a policy every install ignores: refuse it here
verifyPolicy(signed, [...PINNED_RELEASE_KEYS, ...parseReleaseKeys(process.env.DUSK_RELEASE_PUBLIC_KEYS)]);
writeFileSync(values.out, `${JSON.stringify(signed)}\n`);
console.log(`${values.out}: serial ${policy.serial}, floor ${policy.floor ?? "none"}, ${policy.blocked.length} blocked`);
