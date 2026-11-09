// the product's previous names, read so installs made before the rename keep working. every old literal the app still
// needs lives here (the vps installer keeps its own shell copy). nothing new is written under them except the data
// folder's lease, which a build from before the rename must still see to keep out of a folder in use.

// node's modules only when a folder is moved, so pages can import this file too
const node = (name) => globalThis.process.getBuiltinModule(name);
const join = (...parts) => node("node:path").join(...parts);

const OLD = "openmausbot";

export const LEGACY = Object.freeze({
  product: "OpenMausBot",
  devName: OLD,
  dataDirName: `.${OLD}`,
  companionDirName: `.${OLD}-companion`,
  protocol: OLD,
  appId: OLD,
  envPrefixes: ["OMB_", "OPENMAUSBOT_"],
  headerPrefix: `x-${OLD}-`,
  wellKnown: `/.well-known/${OLD}`,
  storagePrefixes: [`${OLD}.`],
  // the default bot's old short name: bot pages call window.mausbot and import "mausbot"; rooms stored by: "mausbot"
  short: "mausbot",
  documentsFolder: "MausBot",
  sentinelLabel: `com.${OLD}.sentinel`,
  linkConfigDir: `${OLD}-link`,
  vpsUnits: { server: `${OLD}.service`, link: `${OLD}-link.service` },
  serveLabel: `com.${OLD}.serve`,
  sentinelUnit: `${OLD}-sentinel`,
});

/** the data folder's lease and its delegated child folder keep their names: builds on both sides of the rename take turns by them */
export const SERVER_LEASE_NAME = `${OLD}-server.lease`;
export const SERVER_CHILD_DIR = `.${OLD}-server-child`;

/** labels and hash inputs that sealed or named something already stored: changing one would lose what it sealed */
export const SEAL_LABELS = Object.freeze({
  phoneCredential: `${OLD}-phone-credential-v1`,
  cardSecret: `${OLD}-card-secret-v1`,
  sealKey: `${OLD}-seal-key-v1`,
  sealedValue: `${OLD}-sealed-value-v1`,
  installation: `${OLD}-installation:`,
  workspaceComputer: `${OLD}:workspace-computer:`,
});

/** docker names on people's machines and in published images: bot computers, their volumes and network keep them */
export const DOCKER_NAMES = Object.freeze({
  label: (name) => `com.${OLD}.${name}`,
  computerContainer: `${OLD}-computer`,
  vpsPrefix: `${OLD}-vps`,
  desktopNetwork: `${OLD}-desktops`,
});

/** a cloud home's own layout: machines set up before the rename take the same commands, and its backups restore anywhere */
export const CLOUD_HOME = Object.freeze({
  root: `/usr/lib/${OLD}`,
  etc: `/etc/${OLD}`,
  run: `/run/${OLD}`,
  gate: `${OLD}-docker`,
  data: `/data/.${OLD}`,
  dataName: `.${OLD}`,
});

/** a phone saved this computer's lan name, so it keeps it */
export const MDNS_HOST_PREFIX = `${OLD}-`;

/** services that still run under the old name: the teams playbook repository (someone else's) and the connected-apps
 * broker until it is deployed again as duskbot-composio (apps/cloudflare/composio-broker) */
export const UPSTREAM = Object.freeze({
  teamLibrary: { repository: `https://github.com/milind-soni/${OLD}-teams`, raw: `https://raw.githubusercontent.com/milind-soni/${OLD}-teams/main` },
  composioBroker: `https://${OLD}-composio.milindsoni201.workers.dev`,
});

const NEW_ENV = "DUSK_";
const NEW_HEADER = "x-dusk-";
const NEW_WELL_KNOWN = "/.well-known/duskbot";
const NEW_STORAGE = "duskbot.";
const NEW_PROTOCOL = "duskbot";

/** OMB_X and OPENMAUSBOT_X become DUSK_X unless DUSK_X is set; the old ones stay so older children still read them. */
export function aliasLegacyEnv(env) {
  if (!env || typeof env !== "object") return env;
  for (const key of Object.keys(env)) {
    const prefix = LEGACY.envPrefixes.find((p) => key.startsWith(p));
    if (!prefix) continue;
    const next = NEW_ENV + key.slice(prefix.length);
    if (env[next] === undefined) env[next] = env[key];
  }
  return env;
}

/** x-openmausbot-* request headers read as x-dusk-*; a value the client sent under the new name always wins. */
export function aliasLegacyHeaders(headers) {
  if (!headers || typeof headers !== "object") return headers;
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (!lower.startsWith(LEGACY.headerPrefix)) continue;
    const next = NEW_HEADER + lower.slice(LEGACY.headerPrefix.length);
    if (headers[next] === undefined) headers[next] = headers[key];
    delete headers[key];
  }
  return headers;
}

/** a header a proxy must strip from untrusted traffic, under either name */
export const isOwnHeader = (name) => {
  const lower = String(name).toLowerCase();
  return lower.startsWith(NEW_HEADER) || lower.startsWith(LEGACY.headerPrefix);
};

/** the same headers again under their old names, for a peer that may predate the rename */
export function withLegacyHeaders(headers) {
  const out = { ...headers };
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase().startsWith(NEW_HEADER)) out[LEGACY.headerPrefix + key.slice(NEW_HEADER.length)] = value;
  }
  return out;
}

/** /.well-known/openmausbot/... answers as /.well-known/duskbot/... */
export function fromLegacyPath(pathname) {
  if (typeof pathname !== "string") return pathname;
  return pathname === LEGACY.wellKnown || pathname.startsWith(`${LEGACY.wellKnown}/`)
    ? NEW_WELL_KNOWN + pathname.slice(LEGACY.wellKnown.length)
    : pathname;
}

/** the same well-known path under its old name, to ask a server that predates the rename */
export function toLegacyPath(pathname) {
  return typeof pathname === "string" && pathname.startsWith(NEW_WELL_KNOWN)
    ? LEGACY.wellKnown + pathname.slice(NEW_WELL_KNOWN.length)
    : pathname;
}

/** a server's health answer names it as ours under either name */
export const isOwnAppId = (app) => app === "duskbot" || app === LEGACY.appId;

/** openmausbot://x becomes duskbot://x; anything else is returned as it came */
export function fromLegacyLink(link) {
  if (typeof link !== "string") return link;
  const old = `${LEGACY.protocol}:`;
  return link.slice(0, old.length).toLowerCase() === old ? `${NEW_PROTOCOL}:${link.slice(old.length)}` : link;
}

/** browser storage keys saved under the old prefix, copied once to the new one; the old keys are left in place */
export function migrateLegacyStorage(storage) {
  if (!storage) return 0;
  let copied = 0;
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      const prefix = key && LEGACY.storagePrefixes.find((p) => key.startsWith(p));
      if (!prefix) continue;
      const next = NEW_STORAGE + key.slice(prefix.length);
      if (storage.getItem(next) !== null) continue;
      storage.setItem(next, storage.getItem(key));
      copied++;
    }
  } catch {
    // storage that refuses (private mode, quota) keeps the defaults
  }
  return copied;
}

const exists = (fs, p) => { try { return fs.lstatSync(p); } catch { return null; } };
const hasData = (fs, dir) => { try { return fs.readdirSync(dir).length > 0; } catch { return false; } };

/**
 * the one-time move of a folder from its old name to its new one. the old path becomes a link to the new folder, so
 * absolute paths saved inside (engine configs, hooks) and anything still holding the old path keep working. nothing is
 * ever deleted: a new folder that already holds data wins and the old one is left as it was; a new folder made empty
 * (or holding only what was written before this ran, with no `marker`) is set aside next to it; a move that fails
 * leaves everything in place and the old folder is used.
 */
export function migrateLegacyDir(next, old, { fs = node("node:fs"), marker = null, now = Date.now, log = () => {} } = {}) {
  const o = exists(fs, old);
  if (!o || o.isSymbolicLink() || !o.isDirectory()) return next;
  if (!hasData(fs, old)) return next;
  const n = exists(fs, next);
  if (n) {
    const fresh = n.isDirectory() && (!hasData(fs, next) || (marker && !exists(fs, join(next, marker)) && exists(fs, join(old, marker))));
    if (!fresh) return next;
    const aside = `${next}.before-move-${now()}`;
    try { fs.renameSync(next, aside); } catch (error) { log(`legacy move: could not set ${next} aside: ${error?.message ?? error}`); return old; }
  }
  try {
    fs.renameSync(old, next);
  } catch (error) {
    log(`legacy move: kept ${old}: ${error?.message ?? error}`);
    return old;
  }
  try {
    fs.symlinkSync(next, old, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    log(`legacy move: no link at ${old}: ${error?.message ?? error}`);
  }
  log(`legacy move: ${old} -> ${next}`);
  return next;
}

/** the data folder in `home`, moved from its old name on first use */
export function defaultDataDir(home, options = {}) {
  return migrateLegacyDir(join(home, ".duskbot"), join(home, LEGACY.dataDirName), { marker: "config.json", ...options });
}

/** the data folder a setting names, or the default; a setting naming the default (a container image's) moves the old one too */
export function dataDirFor(configured, home, options = {}) {
  return !configured || configured === join(home, ".duskbot") ? defaultDataDir(home, options) : configured;
}

/** the companion's folder in `home`, moved from its old name on first use */
export function defaultCompanionDir(home, options = {}) {
  return migrateLegacyDir(join(home, ".duskbot-companion"), join(home, LEGACY.companionDirName), options);
}

/** a data folder's name, old or new, for lists that keep the bots and syncs out of it */
export const DATA_DIR_NAMES = Object.freeze([".duskbot", LEGACY.dataDirName]);

/**
 * electron's own folder (userData) under its old name, copied once to the new one before electron opens it. a copy, not
 * a move: it holds keychain-sealed files, and an older build started again still finds its own.
 */
export function migrateLegacyUserData(next, appData, { fs = node("node:fs"), log = () => {}, packaged = true } = {}) {
  if (exists(fs, next)) return false;
  const old = join(appData, packaged ? LEGACY.product : LEGACY.devName);
  const o = exists(fs, old);
  if (!o || !o.isDirectory() || !hasData(fs, old)) return false;
  const staging = `${next}.moving-${process.pid}`;
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.cpSync(old, staging, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true,
      // chromium's locks belong to the old folder's running process, never to a copy
      filter: (src) => !/(^|[\\/])(SingletonLock|SingletonSocket|SingletonCookie|lockfile)$/.test(src) });
    fs.renameSync(staging, next);
    log(`legacy copy: ${old} -> ${next}`);
    return true;
  } catch (error) {
    log(`legacy copy: kept ${old}: ${error?.message ?? error}`);
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
    return false;
  }
}

/** electron's keychain item for an app called `name` (macOS): "<name> Safe Storage", account "<name> Key" */
export const safeStorageItem = (name) => ({ service: `${name} Safe Storage`, account: `${name} Key` });

/**
 * macOS: the keychain key electron seals files with is named after the app. before electron first uses it, the old
 * key is copied under the new name so files sealed before the rename still open. `run` is `security` with args and
 * stdin. returns what happened.
 */
export function carryLegacySafeStorageKey({ name, packaged = true, run }) {
  const next = safeStorageItem(name);
  const olds = (packaged ? [LEGACY.product, LEGACY.devName] : [LEGACY.devName, LEGACY.product]).map(safeStorageItem);
  const find = (item, reveal) => run(["find-generic-password", "-s", item.service, "-a", item.account, ...(reveal ? ["-w"] : [])]);
  try {
    if (find(next, false).status === 0) return "present";
    for (const old of olds) {
      const read = find(old, true);
      if (read.status !== 0) continue;
      const secret = String(read.stdout ?? "").replace(/\r?\n$/, "");
      if (!secret) continue;
      // through stdin, so the key never shows in a process list
      const quote = (value) => `"${String(value).replace(/["\\]/g, "\\$&")}"`;
      const add = run(["-i"], `add-generic-password -s ${quote(next.service)} -a ${quote(next.account)} -w ${quote(secret)}\n`);
      return add.status === 0 ? "copied" : "failed";
    }
    return "none";
  } catch {
    return "failed";
  }
}

if (typeof process !== "undefined" && process?.env) aliasLegacyEnv(process.env);
// a page: its saved preferences from before the rename, before anything reads them
if (typeof window !== "undefined") { try { migrateLegacyStorage(window.localStorage); } catch {} }
