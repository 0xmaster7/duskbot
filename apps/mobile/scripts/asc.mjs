// App Store Connect API helper for the iPhone app: finds the app record, shows build processing, and puts builds in
// front of internal TestFlight testers. The API cannot create the app record itself; do that once in App Store Connect.
//
//   node apps/mobile/scripts/asc.mjs status                  the app record and its latest builds
//   node apps/mobile/scripts/asc.mjs testflight [email...]   make the internal group (all builds) and add testers
//   node apps/mobile/scripts/asc.mjs metadata                listing, categories, age rating, review notes (store/app-store.json)
//   node apps/mobile/scripts/asc.mjs screenshots <dir> [type] replace the en-US screenshots (default APP_IPHONE_67)
//   node apps/mobile/scripts/asc.mjs free                    price Free (USD 0), every territory but mainland China
//   node apps/mobile/scripts/asc.mjs submit [--yes]          check everything App Review needs; --yes attaches the newest
//                                                            valid build to the version and submits it
//
// Reads APPLE_API_KEY_ID, APPLE_API_ISSUER, APPLE_API_KEY_PATH from the environment, else ~/.config/duskbot/dusk.env.
// Never prints the key or the token.
import { createHash, createPrivateKey, sign } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

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
  const res = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
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

async function bundleIdRecord() {
  const { data } = await call("GET", `/v1/bundleIds?filter[identifier]=${BUNDLE_ID}&limit=5`);
  const one = data.find((b) => b.attributes.identifier === BUNDLE_ID);
  if (!one) throw new Error(`no App ID ${BUNDLE_ID} in the developer account`);
  return one;
}

/** uploads a CSR for an Apple Distribution certificate and writes the certificate (DER) */
async function distCert(csrPath, outPath) {
  const csrContent = readFileSync(csrPath, "utf8").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const { data } = await call("POST", "/v1/certificates", { data: { type: "certificates", attributes: { certificateType: "DISTRIBUTION", csrContent } } });
  writeFileSync(outPath, Buffer.from(data.attributes.certificateContent, "base64"), { mode: 0o600 });
  console.log(`certificate ${data.id}: ${data.attributes.name}, expires ${data.attributes.expirationDate}, written to ${outPath}`);
}

/** makes (or remakes) the App Store profile for the app with one certificate and writes it */
async function storeProfile(certId, outPath, name = "dusk bot App Store") {
  const bundle = await bundleIdRecord();
  const { data: existing } = await call("GET", `/v1/profiles?filter[name]=${encodeURIComponent(name)}&limit=10`);
  for (const old of existing) await call("DELETE", `/v1/profiles/${old.id}`).then(() => console.log(`removed the old profile ${old.id}`));
  const { data } = await call("POST", "/v1/profiles", { data: { type: "profiles", attributes: { name, profileType: "IOS_APP_STORE" }, relationships: {
    bundleId: { data: { type: "bundleIds", id: bundle.id } }, certificates: { data: [{ type: "certificates", id: certId }] } } } });
  writeFileSync(outPath, Buffer.from(data.attributes.profileContent, "base64"), { mode: 0o600 });
  console.log(`profile ${data.id} "${data.attributes.name}" (${data.attributes.uuid}), expires ${data.attributes.expirationDate}, written to ${outPath}`);
}

/** the version being prepared (the one App Review will see) and its en-US localization */
async function editableVersion(appId) {
  const res = await call("GET", `/v1/apps/${appId}/appStoreVersions?filter[appStoreState]=PREPARE_FOR_SUBMISSION,DEVELOPER_REJECTED,REJECTED,METADATA_REJECTED&include=appStoreVersionLocalizations&limit=5`);
  const version = res.data[0];
  if (!version) throw new Error("no editable App Store version (one in Prepare for Submission)");
  const local = (res.included ?? []).find((one) => one.type === "appStoreVersionLocalizations" && one.attributes.locale === "en-US");
  if (!local) throw new Error("the version has no en-US localization");
  return { version, local };
}

/** applies apps/mobile/store/app-store.json: name, subtitle, privacy URL, categories, age rating, the version's text and URLs, review notes */
async function metadata(file) {
  const want = JSON.parse(readFileSync(file, "utf8"));
  const one = await app();
  const infos = await call("GET", `/v1/apps/${one.id}/appInfos?include=appInfoLocalizations,ageRatingDeclaration`);
  const info = infos.data.find((i) => (i.attributes.state ?? i.attributes.appStoreState) !== "READY_FOR_DISTRIBUTION") ?? infos.data[0];
  const infoLocal = infos.included.find((i) => i.type === "appInfoLocalizations" && i.attributes.locale === "en-US");
  const rating = infos.included.find((i) => i.type === "ageRatingDeclarations");
  const { name, subtitle, privacyPolicyUrl, primaryCategory, secondaryCategory } = want.appInfo;
  await call("PATCH", `/v1/appInfoLocalizations/${infoLocal.id}`, { data: { type: "appInfoLocalizations", id: infoLocal.id, attributes: { name, subtitle, privacyPolicyUrl } } });
  console.log("app info: name, subtitle, privacy policy URL");
  // App Review refuses a submission without it: the app ships no third-party content (fonts, art and sounds are our own)
  if (want.contentRightsDeclaration) {
    await call("PATCH", `/v1/apps/${one.id}`, { data: { type: "apps", id: one.id, attributes: { contentRightsDeclaration: want.contentRightsDeclaration } } });
    console.log(`content rights: ${want.contentRightsDeclaration}`);
  }
  await call("PATCH", `/v1/appInfos/${info.id}`, { data: { type: "appInfos", id: info.id, relationships: {
    primaryCategory: { data: { type: "appCategories", id: primaryCategory } }, secondaryCategory: { data: { type: "appCategories", id: secondaryCategory } } } } });
  console.log(`categories: ${primaryCategory}, ${secondaryCategory}`);
  await call("PATCH", `/v1/ageRatingDeclarations/${rating.id}`, { data: { type: "ageRatingDeclarations", id: rating.id, attributes: want.ageRating } });
  console.log("age rating answers");
  const { version, local } = await editableVersion(one.id);
  const { copyright, ...text } = want.version;
  await call("PATCH", `/v1/appStoreVersions/${version.id}`, { data: { type: "appStoreVersions", id: version.id, attributes: { copyright } } });
  await call("PATCH", `/v1/appStoreVersionLocalizations/${local.id}`, { data: { type: "appStoreVersionLocalizations", id: local.id, attributes: text } });
  console.log(`version ${version.attributes.versionString}: copyright, description, keywords, promotional text, support and marketing URLs`);
  // the notes, the demo account and the contact; the demo values and the phone come from dusk.env, never the repo
  const review = reviewDetail(want.reviewNotes);
  if (review.missing.length) { console.log(`review details skipped: add ${review.missing.join(", ")} to dusk.env (App Store Connect refuses the notes without a contact)`); return false; }
  const detail = await call("GET", `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`).catch(() => ({ data: null }));
  if (detail.data) await call("PATCH", `/v1/appStoreReviewDetails/${detail.data.id}`, { data: { type: "appStoreReviewDetails", id: detail.data.id, attributes: review.attributes } });
  else await call("POST", "/v1/appStoreReviewDetails", { data: { type: "appStoreReviewDetails", attributes: review.attributes, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } } });
  console.log(`review details: notes, demo account ${review.attributes.demoAccountName}, contact ${review.attributes.contactFirstName} ${review.attributes.contactLastName}`);
  return true;
}

/** App Review's section: the notes with the demo account filled in, and the contact. Reports what dusk.env still lacks. */
function reviewDetail(notes) {
  const email = env("DUSK_REVIEW_EMAIL"), code = env("DUSK_REVIEW_CODE"), phone = env("APP_REVIEW_CONTACT_PHONE");
  const missing = [["DUSK_REVIEW_EMAIL", email], ["DUSK_REVIEW_CODE", code], ["APP_REVIEW_CONTACT_PHONE (like +91 98765 43210)", phone]].filter(([, v]) => !v).map(([k]) => k);
  if (phone && !/^\+\d[\d ()-]{6,}$/.test(phone)) missing.push("APP_REVIEW_CONTACT_PHONE must start with + and the country code");
  const filled = notes.replace("[REVIEW EMAIL]", email).replace(/\[REVIEW CODE[^\]]*\]/, `${code} (fixed for this account; no email is sent)`);
  return { missing, attributes: {
    notes: filled, demoAccountRequired: true, demoAccountName: email, demoAccountPassword: code,
    contactFirstName: env("APP_REVIEW_CONTACT_FIRST_NAME") || "Siddharth", contactLastName: env("APP_REVIEW_CONTACT_LAST_NAME") || "Meena",
    contactEmail: env("APP_REVIEW_CONTACT_EMAIL") || "hello@dusk.bot", contactPhone: phone } };
}

/** the app is free: price USD 0 (Free) and available everywhere except mainland China, where AI chat apps need a
 *  government licence */
async function free() {
  const one = await app();
  const { data: points } = await call("GET", `/v1/apps/${one.id}/appPricePoints?filter[territory]=USA&limit=200`);
  const zero = points.find((p) => p.attributes.customerPrice === "0.0");
  if (!zero) throw new Error("no USD 0 price point");
  const priced = await call("GET", `/v1/apps/${one.id}/appPriceSchedule?include=manualPrices`).catch(() => null);
  if (!priced?.included?.some((p) => p.type === "appPrices")) await call("POST", "/v1/appPriceSchedules", { data: { type: "appPriceSchedules", relationships: { app: { data: { type: "apps", id: one.id } },
    baseTerritory: { data: { type: "territories", id: "USA" } }, manualPrices: { data: [{ type: "appPrices", id: "${free}" }] } } },
    included: [{ type: "appPrices", id: "${free}", attributes: { startDate: null }, relationships: { appPricePoint: { data: { type: "appPricePoints", id: zero.id } } } }] });
  console.log("price: Free (USD 0)");
  const { data: territories } = await call("GET", "/v1/territories?limit=200");
  const all = territories.map((t) => t.id), open = all.filter((id) => id !== "CHN");
  const existing = await call("GET", `/v1/apps/${one.id}/appAvailabilityV2`).catch(() => null);
  if (existing?.data) { console.log("availability already set; change it in App Store Connect if needed"); return; }
  await call("POST", "/v2/appAvailabilities", { data: { type: "appAvailabilities", attributes: { availableInNewTerritories: true }, relationships: {
    app: { data: { type: "apps", id: one.id } }, territoryAvailabilities: { data: all.map((id) => ({ type: "territoryAvailabilities", id: `\${${id}}` })) } } },
    included: all.map((id) => ({ type: "territoryAvailabilities", id: `\${${id}}`, attributes: { available: id !== "CHN" }, relationships: { territory: { data: { type: "territories", id } } } })) });
  console.log(`availability: ${open.length} territories (not mainland China), new territories on`);
}

/** checks everything App Review needs, then (with --yes) attaches the newest valid build and submits the version */
async function submit(yes) {
  const one = await app();
  const { version, local } = await editableVersion(one.id);
  const problems = [], ok = (line) => console.log(`  ok    ${line}`);
  const { data: builds } = await call("GET", `/v1/builds?filter[app]=${one.id}&filter[processingState]=VALID&filter[expired]=false&sort=-uploadedDate&limit=1&fields[builds]=version,usesNonExemptEncryption,uploadedDate`);
  const build = builds[0];
  if (!build) problems.push("no valid, unexpired build: run apps/mobile/scripts/build-ios-release.sh --upload");
  else {
    ok(`build ${build.attributes.version} (uploaded ${build.attributes.uploadedDate})`);
    if (build.attributes.usesNonExemptEncryption !== false) problems.push(`build ${build.attributes.version} has no export compliance answer (ITSAppUsesNonExemptEncryption = NO in Info.plist)`);
    else ok("export compliance: no non-exempt encryption");
  }
  const sets = await call("GET", `/v1/appStoreVersionLocalizations/${local.id}/appScreenshotSets?include=appScreenshots`);
  const shots = (sets.included ?? []).filter((s) => s.type === "appScreenshots" && s.attributes.assetDeliveryState?.state === "COMPLETE").length;
  if (!shots) problems.push("no finished screenshots: node apps/mobile/scripts/asc.mjs screenshots docs/store/ios/6.9");
  else ok(`${shots} screenshots`);
  const review = reviewDetail(JSON.parse(readFileSync(new URL("../store/app-store.json", import.meta.url), "utf8")).reviewNotes);
  if (review.missing.length) problems.push(`review details: add ${review.missing.join(", ")} to dusk.env, then run metadata`);
  else {
    const detail = await call("GET", `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`).catch(() => ({ data: null }));
    const a = detail.data?.attributes ?? {};
    if (a.contactPhone !== review.attributes.contactPhone || a.demoAccountName !== review.attributes.demoAccountName || a.notes !== review.attributes.notes) problems.push("review details on App Store Connect are not the current ones: run node apps/mobile/scripts/asc.mjs metadata");
    else ok(`review details: demo account ${a.demoAccountName}, contact phone set`);
  }
  if (!env("DUSK_REVIEW_AI_OPENROUTER_KEY")) problems.push("DUSK_REVIEW_AI_OPENROUTER_KEY is empty: the demo bot has no working AI (then node apps/dashboard/scripts/review-ai.mjs production)");
  else ok("demo bot AI key present");
  const price = await call("GET", `/v1/apps/${one.id}/appPriceSchedule?include=manualPrices`).catch(() => null);
  if (!price?.included?.some((p) => p.type === "appPrices")) problems.push("no price set: App Store Connect, Pricing and Availability, Free (USD 0), all territories");
  else ok("price schedule set");
  if (problems.length) { console.log(`\nnot ready, ${problems.length} left:`); for (const p of problems) console.log(`  - ${p}`); process.exitCode = 1; return; }
  if (!yes) { console.log(`\nready: run again with --yes to attach build ${build.attributes.version} to ${version.attributes.versionString} and submit for review`); return; }
  await call("PATCH", `/v1/appStoreVersions/${version.id}/relationships/build`, { data: { type: "builds", id: build.id } });
  console.log(`attached build ${build.attributes.version} to ${version.attributes.versionString}`);
  // an earlier try that stopped at the item leaves an empty draft submission open: use it rather than open another
  const open = (await call("GET", `/v1/reviewSubmissions?filter[app]=${one.id}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW&limit=10`)).data;
  const sub = open[0] ?? (await call("POST", "/v1/reviewSubmissions", { data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: one.id } } } } })).data;
  for (const extra of open.slice(1)) await call("PATCH", `/v1/reviewSubmissions/${extra.id}`, { data: { type: "reviewSubmissions", id: extra.id, attributes: { canceled: true } } }).catch(() => {});
  await call("POST", "/v1/reviewSubmissionItems", { data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: { data: { type: "reviewSubmissions", id: sub.id } }, appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } } } });
  await call("PATCH", `/v1/reviewSubmissions/${sub.id}`, { data: { type: "reviewSubmissions", id: sub.id, attributes: { submitted: true } } });
  console.log(`submitted ${version.attributes.versionString} for review (submission ${sub.id})`);
}

/** replaces the en-US screenshots of one display type with the PNGs in dir, in file name order */
async function screenshots(dir, displayType) {
  const files = readdirSync(dir).filter((name) => name.endsWith(".png")).sort().map((name) => join(dir, name));
  if (!files.length) throw new Error(`no PNGs in ${dir}`);
  const { local } = await editableVersion((await app()).id);
  const sets = await call("GET", `/v1/appStoreVersionLocalizations/${local.id}/appScreenshotSets?include=appScreenshots`);
  let set = sets.data.find((one) => one.attributes.screenshotDisplayType === displayType);
  if (!set) ({ data: set } = await call("POST", "/v1/appScreenshotSets", { data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: displayType }, relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: local.id } } } } }));
  for (const old of set.relationships?.appScreenshots?.data ?? []) await call("DELETE", `/v1/appScreenshots/${old.id}`);
  const ids = [];
  for (const file of files) {
    const body = readFileSync(file);
    const { data: shot } = await call("POST", "/v1/appScreenshots", { data: { type: "appScreenshots", attributes: { fileName: basename(file), fileSize: statSync(file).size }, relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: set.id } } } } });
    for (const op of shot.attributes.uploadOperations) {
      const res = await fetch(op.url, { method: op.method, headers: Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value])), body: body.subarray(op.offset, op.offset + op.length) });
      if (!res.ok) throw new Error(`uploading ${basename(file)}: ${res.status}`);
    }
    await call("PATCH", `/v1/appScreenshots/${shot.id}`, { data: { type: "appScreenshots", id: shot.id, attributes: { uploaded: true, sourceFileChecksum: createHash("md5").update(body).digest("hex") } } });
    ids.push(shot.id);
    console.log(`uploaded ${basename(file)}`);
  }
  await call("PATCH", `/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, { data: ids.map((id) => ({ type: "appScreenshots", id })) });
  console.log(`${displayType}: ${ids.length} screenshots, in order`);
}

const [verb, ...rest] = process.argv.slice(2);
const run = {
  status: () => status(),
  testflight: () => testflight(rest),
  get: async () => console.log(JSON.stringify(await call("GET", rest[0]), null, 1)),
  "dist-cert": () => distCert(rest[0], rest[1]),
  "store-profile": () => storeProfile(rest[0], rest[1], rest[2]),
  metadata: () => metadata(rest[0] ?? new URL("../store/app-store.json", import.meta.url).pathname),
  screenshots: () => screenshots(rest[0], rest[1] ?? "APP_IPHONE_67"),
  submit: () => submit(rest.includes("--yes")),
  free: () => free(),
}[verb];
if (!run) { console.error("usage: node apps/mobile/scripts/asc.mjs status | testflight [email...] | get <path> | dist-cert <csr> <out.cer> | store-profile <certId> <out.mobileprovision> [name] | metadata [app-store.json] | screenshots <dir> [displayType] | free | submit [--yes]"); process.exit(2); }
run().catch((error) => { console.error(`error: ${error.message}`); process.exit(1); });
