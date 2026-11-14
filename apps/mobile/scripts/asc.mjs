// App Store Connect API helper for the iPhone app: finds the app record, shows build processing, and puts builds in
// front of internal TestFlight testers. The API cannot create the app record itself; do that once in App Store Connect.
//
//   node apps/mobile/scripts/asc.mjs status                  the app record and its latest builds
//   node apps/mobile/scripts/asc.mjs testflight [email...]   make the internal group (all builds) and add testers
//
// Reads APPLE_API_KEY_ID, APPLE_API_ISSUER, APPLE_API_KEY_PATH from the environment, else ~/.config/duskbot/dusk.env.
// Never prints the key or the token.
import { createPrivateKey, sign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BUNDLE_ID = "bot.dusk.mobile";
const GROUP = "dusk team";
const API = "https://api.appstoreconnect.apple.com";

function env(name) {
  if (process.env[name]) return process.env[name];
  const file = process.env.DUSK_ENV_FILE ?? join(homedir(), ".config/duskbot/dusk.env");
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^(["'])(.*)\1$/, "$2") : "";
}

function token() {
  const kid = env("APPLE_API_KEY_ID"), iss = env("APPLE_API_ISSUER"), path = env("APPLE_API_KEY_PATH");
  const missing = [["APPLE_API_KEY_ID", kid], ["APPLE_API_ISSUER", iss], ["APPLE_API_KEY_PATH", path]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`missing ${missing.join(", ")} (see docs/store-launch.md, iOS signing)`);
  if (!existsSync(path)) throw new Error("APPLE_API_KEY_PATH points at a file that does not exist");
  const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = `${b64({ alg: "ES256", kid, typ: "JWT" })}.${b64({ iss, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" })}`;
  const sig = sign("sha256", Buffer.from(head), { key: createPrivateKey(readFileSync(path)), dsaEncoding: "ieee-p1363" });
  return `${head}.${sig.toString("base64url")}`;
}

let bearer;
async function call(method, path, body) {
  bearer ??= token();
  const res = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path.split("?")[0]}: ${res.status} ${json.errors?.map((e) => e.detail ?? e.title).join("; ") ?? text.slice(0, 200)}`);
  return json;
}

async function app() {
  const { data } = await call("GET", `/v1/apps?filter[bundleId]=${BUNDLE_ID}&limit=1`);
  if (!data.length) throw new Error(`no App Store Connect app for ${BUNDLE_ID} yet: create it in App Store Connect, Apps, +, New App (docs/store-launch.md)`);
  return data[0];
}

async function status() {
  const one = await app();
  console.log(`app: ${one.attributes.name} (${one.id}), sku ${one.attributes.sku}`);
  const { data } = await call("GET", `/v1/builds?filter[app]=${one.id}&sort=-uploadedDate&limit=5&fields[builds]=version,processingState,uploadedDate,expired`);
  if (!data.length) console.log("no builds uploaded yet");
  for (const b of data) console.log(`build ${b.attributes.version}: ${b.attributes.processingState}${b.attributes.expired ? " (expired)" : ""}, uploaded ${b.attributes.uploadedDate}`);
}

async function testflight(emails) {
  const one = await app();
  const { data: groups } = await call("GET", `/v1/apps/${one.id}/betaGroups?limit=50`);
  let group = groups.find((g) => g.attributes.isInternalGroup && g.attributes.name === GROUP);
  if (!group) {
    ({ data: group } = await call("POST", "/v1/betaGroups", { data: { type: "betaGroups", attributes: { name: GROUP, isInternalGroup: true, hasAccessToAllBuilds: true }, relationships: { app: { data: { type: "apps", id: one.id } } } } }));
    console.log(`made the internal group "${GROUP}" (every new build reaches it once processed)`);
  } else console.log(`internal group "${GROUP}" exists`);
  for (const email of emails) {
    // internal testers must already be users of the App Store Connect team (Users and Access)
    await call("POST", "/v1/betaTesters", { data: { type: "betaTesters", attributes: { email }, relationships: { betaGroups: { data: [{ type: "betaGroups", id: group.id }] } } } })
      .then(() => console.log(`added ${email}`))
      .catch((error) => console.error(`${email}: ${error.message}`));
  }
}

const [verb, ...rest] = process.argv.slice(2);
const run = { status: () => status(), testflight: () => testflight(rest) }[verb];
if (!run) { console.error("usage: node apps/mobile/scripts/asc.mjs status | testflight [email...]"); process.exit(2); }
run().catch((error) => { console.error(`error: ${error.message}`); process.exit(1); });
