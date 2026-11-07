// main's side of "Add your VPS": the controller (vps-link.mjs) over electron's own pieces, ipc for this computer's page
// only, a pinned tls key for a server reached directly, and this mac's own ai sign-ins read or made locally.
import { spawn } from "node:child_process";
import { X509Certificate, createHash } from "node:crypto";
import { createReadStream, createWriteStream, promises as fsp, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { newDirectKey, sshConnector } from "./vps-link-direct.mjs";
import { createEgressDialer, createEgressEndpoint, seenAsCache } from "./vps-link-egress.mjs";
import { createVpsLink } from "./vps-link.mjs";

export const DEFAULT_LINK_BASE = "https://link.apps.siddz.com";

/**
 * a linked server's page is http://vps-<id>.localhost, and every request it makes crosses the tunnel. chromium gives a
 * host six connections, so a page's burst (startup asks ~20 things) waited in line a whole tunnel round trip per six;
 * measured on a linked vps, requests queued up to 12 s. "localhost" covers every vps-<id>.localhost and only loopback
 * names. call before the app is ready.
 */
export function unlimitTunnelConnections(app) {
  app.commandLine.appendSwitch("ignore-connections-limit", "localhost");
}

/** reads a value saved by protect; electron's async safeStorage decrypt answers { result }, not a bare string */
export function unprotectWith(encryption) {
  return async (value) => {
    if (!value.startsWith("e:")) return value.slice(2);
    const out = await encryption.decrypt(Buffer.from(value.slice(2), "base64"));
    return typeof out === "string" ? out : String(out?.result ?? "");
  };
}
const METHODS = ["state", "start", "cancel", "reset", "engines", "signIn", "signInStatus", "signInCode", "signInCancel", "openUrl", "preview", "move", "retryMove", "open", "where", "backups", "backupNow", "restore", "moveBack", "forget"];

/** the tls verifier for the servers this app pinned: their own key, on top of the usual checks; every other host as usual */
export function createPins() {
  const pins = new Map();
  return {
    add: (host, spki) => pins.set(host.toLowerCase(), spki),
    size: () => pins.size,
    verify(request, callback) {
      const pin = pins.get(String(request.hostname).toLowerCase());
      if (!pin) return callback(-3);
      if (request.verificationResult !== "net::OK") return callback(-2);
      try {
        const der = new X509Certificate(request.certificate.data).publicKey.export({ type: "spki", format: "der" });
        return callback(createHash("sha256").update(der).digest("base64") === pin ? 0 : -2);
      } catch { return callback(-2); }
    },
  };
}

/** `claude setup-token` on this mac: it opens the browser itself and prints a long-lived token for headless use */
export function claudeSetupToken(cli, signal, { spawnImpl = spawn, timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(cli, ["setup-token"], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "0" } });
    let output = "";
    const done = (error, token) => { clearTimeout(timer); signal.removeEventListener("abort", stop); if (error) reject(error); else resolve(token); };
    const stop = () => { child.kill(); done(new Error("cancelled")); };
    const timer = setTimeout(() => { child.kill(); done(new Error("Claude sign-in timed out")); }, timeoutMs);
    signal.addEventListener("abort", stop, { once: true });
    const read = (chunk) => {
      output = (output + chunk.toString("utf8")).slice(-65_536);
      const match = /sk-ant-oat01-[A-Za-z0-9_-]{20,}/.exec(output);
      if (match) { done(null, match[0]); child.stdin?.end(); }
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.on("error", (error) => done(error));
    child.on("exit", () => done(new Error("Claude closed before it finished signing in")));
  });
}

async function folderSize(dir, limit = 200_000) {
  let total = 0, seen = 0;
  const walk = async (folder) => {
    let entries;
    try { entries = await fsp.readdir(folder, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (++seen > limit) return;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) { try { total += (await fsp.stat(full)).size; } catch { /* gone */ } }
    }
  };
  await walk(dir);
  return total;
}

/**
 * Settings > Computer "Fast direct connection", asked by a linked server's own page: main names the link from the page
 * that asks (the main window at the active server), never from anything the page says.
 * @param {{ ipcMain: any, pageOrigin(event: any): string | null, link: { directSetting(origin: string): unknown, setDirect(origin: string, on: boolean): Promise<unknown> } }} deps
 */
export function installLinkDirectIpc({ ipcMain, pageOrigin, link }) {
  ipcMain.handle("link-direct:state", (event) => {
    const origin = pageOrigin(event);
    return origin ? link.directSetting(origin) : null;
  });
  ipcMain.handle("link-direct:set", (event, on) => {
    const origin = pageOrigin(event);
    if (!origin) throw new Error("This page cannot change the connection.");
    return link.setDirect(origin, on === true);
  });
}

/**
 * @param {{
 *   ipcMain: any, guard(channel: string, handler: Function): Function, userData: string, session: any, shell: any,
 *   encryption: { available(): Promise<boolean>, encrypt(text: string): Promise<Buffer>, decrypt(value: Buffer): Promise<string | { result: string }> },
 *   jsonFile(file: string): { read(): unknown, write(value: unknown): void },
 *   environments(): any, persist(next: any): void, withEnvironment: Function, makeId(): string, forgetEnvironment(id: string): unknown,
 *   ownHome: any, localRequest(route: string, init?: RequestInit): Promise<Response>, switchTo(id: string): unknown, relaunch(): void,
 *   dataDir(): string | null, label(): string, tell(view: unknown): void, log(line: string): void, base?: string,
 *   powerMonitor?: { on(event: string, listener: () => void): unknown },
 *   pageOrigin?(event: any): string | null,
 * }} deps
 */
export function installVpsLink(deps) {
  const { ipcMain, guard, userData, session, shell, encryption, jsonFile, log } = deps;
  const pins = createPins();
  let pinned = false;
  const backupsDir = path.join(userData, "vps-backups");
  const protect = async (text) => ((await encryption.available()) ? `e:${(await encryption.encrypt(text)).toString("base64")}` : `p:${text}`);
  const unprotect = unprotectWith(encryption);
  const ownHomeFiles = ["own-home.json", "own-home-choice.json", "own-home-send.json"].map((name) => jsonFile(path.join(userData, name)));

  const base = (deps.base || process.env.OMB_LINK_BASE || DEFAULT_LINK_BASE).replace(/\/+$/, "");
  // the link service tells this computer the public address it connects from, so its home router stays out of reach
  const seenAs = seenAsCache(async () => (await (await fetch(`${base}/v1/ip`, { signal: AbortSignal.timeout(5000) })).json())?.ip, { log });
  const link = createVpsLink({
    base,
    egress: (tunnel) => createEgressEndpoint({ ...tunnel, dialer: createEgressDialer({ seenAs }) }),
    serverFetch: (...args) => session.defaultSession.fetch(...args),
    store: jsonFile(path.join(userData, "vps-link.json")),
    protect, unprotect,
    label: deps.label,
    saveServer({ origin, name }) {
      const next = deps.withEnvironment(deps.environments(), { origin, name }, deps.makeId);
      deps.persist(next);
      return next.environments.find((entry) => entry.origin === origin)?.id;
    },
    forgetServer: (id) => deps.forgetEnvironment(id),
    retarget(from, to) {
      const state = deps.environments();
      deps.persist({ ...state, environments: state.environments.map((entry) => (entry.origin === from ? { ...entry, origin: to } : entry)) });
    },
    switchTo: deps.switchTo,
    pin(host, spki) {
      pins.add(host, spki);
      if (!pinned) { pinned = true; session.defaultSession.setCertificateVerifyProc((request, callback) => pins.verify(request, callback)); }
    },
    ownHome: deps.ownHome,
    ownHomeReset: () => { for (const file of ownHomeFiles) { try { file.write(null); } catch (error) { log(`vps link: could not reset the move record (${error?.message ?? error})`); } } },
    localRequest: deps.localRequest,
    backups: {
      async save(name, body) {
        await fsp.mkdir(backupsDir, { recursive: true, mode: 0o700 });
        const file = path.join(backupsDir, path.basename(name));
        await pipeline(body instanceof Uint8Array ? Readable.from([body]) : Readable.fromWeb(body), createWriteStream(file, { flags: "wx", mode: 0o600 }));
        return { file, bytes: statSync(file).size };
      },
      async open(file) {
        if (path.dirname(file) !== backupsDir) throw new Error("That backup is not one this app saved.");
        return { body: createReadStream(file), size: statSync(file).size };
      },
    },
    localCredentials: {
      async codexAuth() {
        const file = path.join(process.env.CODEX_HOME || path.join(homedir(), ".codex"), "auth.json");
        try { const text = readFileSync(file, "utf8"); JSON.parse(text); return text; } catch { return null; }
      },
      async claudeCli() {
        const response = await deps.localRequest("/api/cli-candidates?name=claude");
        const body = await response.json().catch(() => ({}));
        return Array.isArray(body?.candidates) && typeof body.candidates[0] === "string" ? body.candidates[0] : null;
      },
      claudeToken: (cli, signal) => claudeSetupToken(cli, signal),
    },
    relaunch: deps.relaunch,
    dataSize: async () => { const dir = deps.dataDir(); return dir ? folderSize(dir) : null; },
    // the direct path to a relay-linked server (vps-link-direct.mjs); OMB_LINK_DIRECT=off keeps every link on the relay
    ...(process.env.OMB_LINK_DIRECT === "off" ? {} : { direct: { newKey: newDirectKey, connector: sshConnector } }),
    onChange: (view) => deps.tell(view),
    log,
  });

  const handlers = {
    state: () => link.view(),
    start: () => link.start(),
    cancel: () => link.cancel(),
    reset: () => link.reset(),
    engines: () => link.engines(),
    signIn: (_event, id) => link.signIn(String(id)),
    signInStatus: (_event, id, flowId) => link.signInStatus(String(id), String(flowId)),
    signInCode: (_event, id, flowId, code) => link.signInCode(String(id), String(flowId), String(code)),
    signInCancel: (_event, id, flowId) => link.signInCancel(String(id), String(flowId)),
    async openUrl(_event, url) {
      const parsed = new URL(String(url));
      if (parsed.protocol !== "https:") throw new Error("Only https links open from here.");
      await shell.openExternal(parsed.href);
    },
    preview: () => link.preview(),
    move: () => link.move(),
    retryMove: () => link.retryMove(),
    open: () => link.open(),
    where: () => link.where(),
    backups: () => link.backups(),
    backupNow: () => link.backupNow(),
    restore: (_event, id) => link.restore(String(id)),
    moveBack: () => link.moveBack(),
    forget: () => link.forget(),
  };
  for (const method of METHODS) ipcMain.handle(`vps-link:${method}`, guard(`vps-link:${method}`, handlers[method]));
  installLinkDirectIpc({ ipcMain, pageOrigin: deps.pageOrigin ?? (() => null), link });
  // safeStorage only works once electron is ready, and every saved tunnel key needs it
  void (deps.whenReady?.() ?? Promise.resolve()).then(() => {
    // a wake or an unlocked screen: sockets may be dead, so the tunnels reconnect now instead of after their timeouts
    // (powerMonitor only works once electron is ready)
    for (const event of ["resume", "unlock-screen"]) deps.powerMonitor?.on(event, () => link.nudge());
    return link.resume();
  }).catch((error) => log(`vps link: ${error?.message ?? error}`));
  return link;
}
