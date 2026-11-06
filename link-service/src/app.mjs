// the link service: (1) one-time setup sessions the app opens and the vps install script reports into, (2) the install
// and uninstall scripts and the agent, (3) a relay tunnel of frames both ends seal, so it never reads a request, a reply or a credential.
//
// trust: the app holds the secrets. the relay stores only sha256 verifiers of bearer tokens and passes sealed blobs on.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

import { createPackages } from "./packages.mjs";
import { MAX_EVENTS, MAX_SESSIONS, MAX_TUNNELS, SESSION_LIFE_MS, createStore } from "./store.mjs";

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export const ID = /^[a-z2-7]{10}$/;
export const TOKEN = /^[a-z2-7]{10}-[a-z2-7]{26}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const STEP = /^[a-z][a-z0-9-]{0,31}$/;
const STATUSES = new Set(["running", "done", "failed", "skipped"]);
const NONCE = /^[a-z0-9]{16,64}$/;

const MAX_BODY = 4 * 1024 * 1024;
const MAX_SMALL_BODY = 64 * 1024;
const MAX_LOG = 4000;
// live terminal lines a step streams while it runs: per event, and how many such events a session keeps
const MAX_LINES = 60;
const MAX_LINE = 400;
const MAX_LINES_BYTES = 16 * 1024;
const MAX_CMD = 300;
const KEEP_LINE_EVENTS = 150;
const MAX_WAIT_S = 25;
const FRAME_MAX = 1024 * 1024 + 64;
const QUEUE_FRAMES = 1024;
const QUEUE_BYTES = 16 * 1024 * 1024;
const CREATE_PER_HOUR = 30;
/** downloads (server build and desktop kit together) one install session may make; install.sh retries three times */
const PACKAGE_DOWNLOADS = 10;

export const sha256hex = (value) => createHash("sha256").update(value).digest("hex");
export function randomB32(length) {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += B32[bytes[i] & 31];
  return out;
}

function sameHash(token, verifier) {
  if (typeof token !== "string" || !token || typeof verifier !== "string" || !HEX64.test(verifier)) return false;
  return timingSafeEqual(Buffer.from(sha256hex(token), "hex"), Buffer.from(verifier, "hex"));
}

function bearer(req) {
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{16,200})$/.exec(String(req.headers.authorization ?? ""));
  return match ? match[1] : null;
}

/** a public, routable ipv4 or ipv6 address; never loopback, private, link-local or cgnat space */
export function publicIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return !(lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80") || lower.startsWith("::ffff:"));
  }
  return false;
}

/** queues of sealed frames, one per direction per tunnel, with long-poll waiters. never persisted. */
function frameQueue() {
  const frames = [];
  let bytes = 0;
  const waiters = new Set();
  return {
    push(list) {
      const size = list.reduce((sum, frame) => sum + frame.length, 0);
      if (frames.length + list.length > QUEUE_FRAMES || bytes + size > QUEUE_BYTES) return false;
      frames.push(...list);
      bytes += size;
      for (const wake of waiters) wake();
      waiters.clear();
      return true;
    },
    take(max = 256, maxBytes = 4 * 1024 * 1024) {
      let count = 0, size = 0;
      while (count < frames.length && count < max && (count === 0 || size + frames[count].length <= maxBytes)) size += frames[count++].length;
      const out = frames.splice(0, count);
      bytes -= out.reduce((sum, frame) => sum + frame.length, 0);
      return out;
    },
    get length() { return frames.length; },
    wait(ms, signal) {
      return new Promise((resolve) => {
        const done = () => { clearTimeout(timer); waiters.delete(done); signal?.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, ms);
        waiters.add(done);
        signal?.addEventListener("abort", done, { once: true });
      });
    },
    wakeAll() { for (const wake of waiters) wake(); waiters.clear(); },
  };
}

/**
 * @param {{
 *   base: string,
 *   dataDir?: string | null,
 *   scriptPath: string,
 *   uninstallPath?: string,
 *   agentPath: string,
 *   packagesDir?: string | null,
 *   trustProxy?: boolean,
 *   now?: () => number,
 *   fetch?: typeof fetch,
 *   log?: (line: string) => void,
 * }} options
 */
export function createLinkService({ base, dataDir = null, scriptPath, uninstallPath = join(dirname(scriptPath), "uninstall.sh"), agentPath, packagesDir, trustProxy = true, now = Date.now, fetch: fetchImpl = fetch, log = () => {} }) {
  const store = createStore({ dir: dataDir, now });
  const packages = createPackages(packagesDir !== undefined ? packagesDir : dataDir ? join(dataDir, "packages") : null);
  const sessionWaiters = new Map();
  const queues = new Map();
  const created = new Map();
  const cache = new Map();

  function file(path) {
    const mtime = statSync(path).mtimeMs;
    const known = cache.get(path);
    if (known && known.mtime === mtime) return known.text;
    const text = readFileSync(path, "utf8");
    cache.set(path, { mtime, text });
    return text;
  }

  function clientIp(req) {
    if (trustProxy) {
      const real = String(req.headers["x-real-ip"] ?? "").trim();
      if (isIP(real)) return real;
      // the hop our own proxy added is the last one; earlier entries are whatever the client sent
      const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",").pop().trim();
      if (isIP(forwarded)) return forwarded;
    }
    const socket = String(req.socket?.remoteAddress ?? "");
    return socket.startsWith("::ffff:") ? socket.slice(7) : socket;
  }

  function send(res, status, body, headers = {}) {
    const text = body === null ? "" : JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
    res.end(text);
  }
  const fail = (res, status, error, code) => send(res, status, { error, ...(code ? { code } : {}) });

  async function readJson(req, limit = MAX_SMALL_BODY) {
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) throw Object.assign(new Error("send json"), { status: 415 });
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw Object.assign(new Error("too large"), { status: 413 });
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
    catch { throw Object.assign(new Error("bad json"), { status: 400 }); }
  }

  function wakeSession(id) {
    const waiters = sessionWaiters.get(id);
    if (!waiters) return;
    sessionWaiters.delete(id);
    for (const wake of waiters) wake();
  }
  function waitSession(id, ms, signal) {
    return new Promise((resolve) => {
      let waiters = sessionWaiters.get(id);
      if (!waiters) sessionWaiters.set(id, (waiters = new Set()));
      const done = () => { clearTimeout(timer); waiters.delete(done); signal?.removeEventListener("abort", done); resolve(); };
      const timer = setTimeout(done, ms);
      waiters.add(done);
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  function view(session, after) {
    const state = store.stateOf(session);
    return {
      state,
      expiresAt: session.state === "waiting" ? Math.min(session.createdAt + 30 * 60_000, session.createdAt + SESSION_LIFE_MS) : session.createdAt + SESSION_LIFE_MS,
      events: session.events.filter((event) => event.seq > after),
      ...(session.host ? { host: session.host } : {}),
      ...(state === "linked" ? { sealed: session.sealed, vpsPub: session.vpsPub, tunnel: session.tunnel ?? null } : {}),
    };
  }

  function queue(tunnelId, dir) {
    const key = `${tunnelId}:${dir}`;
    let found = queues.get(key);
    if (!found) queues.set(key, (found = frameQueue()));
    return found;
  }

  function vpsSession(req, res, id) {
    const session = store.sessions.get(id);
    if (!session) { fail(res, 404, "This command expired. Make a new one in the app.", "expired"); return null; }
    if (!sameHash(bearer(req), session.vpsVerifier)) { fail(res, 401, "This command is not valid.", "unauthorized"); return null; }
    const state = store.stateOf(session);
    if (state === "linked" || state === "cancelled") { fail(res, 410, "This command was already used. Make a new one in the app.", "used"); return null; }
    if (state === "expired") { fail(res, 404, "This command expired. Make a new one in the app.", "expired"); return null; }
    return session;
  }
  function appSession(req, res, id) {
    const session = store.sessions.get(id);
    if (!session || !sameHash(bearer(req), session.watchVerifier)) { fail(res, 404, "not found", "not_found"); return null; }
    return session;
  }
  function tunnelFor(req, res, id, role) {
    const tunnel = ID.test(id) ? store.tunnels.get(id) : null;
    const token = bearer(req);
    const ok = tunnel && (role === "either" ? sameHash(token, tunnel.vpsVerifier) || sameHash(token, tunnel.appVerifier) : sameHash(token, role === "vps" ? tunnel.vpsVerifier : tunnel.appVerifier));
    if (!ok) { fail(res, 404, "not found", "not_found"); return null; }
    return tunnel;
  }

  async function probe(ip, nonce) {
    if (!publicIp(ip)) return false;
    const host = isIP(ip) === 6 ? `[${ip}]` : ip;
    try {
      const response = await fetchImpl(`http://${host}/.well-known/omb-link/${nonce}`, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      if (!response.ok) return false;
      const text = (await response.text()).slice(0, 200).trim();
      return text === nonce;
    } catch { return false; }
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://link.invalid");
    const path = url.pathname;
    const method = req.method ?? "GET";
    let parts;

    if (method === "GET" && path === "/healthz") return send(res, 200, { ok: true });
    if (method === "GET" && path === "/v1/ip") return send(res, 200, { ip: clientIp(req) });
    if (method === "GET" && (path === "/i" || path === "/install.sh" || (parts = /^\/i\/([a-z2-7-]{37})$/.exec(path)))) {
      const token = parts?.[1] ?? null;
      if (token !== null && !TOKEN.test(token)) return fail(res, 404, "not found");
      let script = file(scriptPath).replaceAll("__LINK_BASE__", base);
      if (token) script = script.replaceAll("__LINK_TOKEN__", token);
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      return res.end(script);
    }
    // the undo: public like /i (nothing secret in it), no session needed
    if (method === "GET" && (path === "/uninstall" || path === "/uninstall.sh")) {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      return res.end(file(uninstallPath).replaceAll("__LINK_BASE__", base));
    }
    if (method === "GET" && path === "/agent.mjs") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      return res.end(file(agentPath));
    }

    if (method === "POST" && path === "/v1/sessions") {
      const ip = clientIp(req);
      const t = now();
      const recent = (created.get(ip) ?? []).filter((at) => t - at < 3_600_000);
      if (recent.length >= CREATE_PER_HOUR) return fail(res, 429, "Too many new links from here. Try again in a while.", "rate_limited");
      store.sweep();
      if (store.sessions.size >= MAX_SESSIONS) return fail(res, 503, "The link service is busy. Try again in a minute.", "busy");
      const body = await readJson(req);
      if (!HEX64.test(body?.verifier ?? "")) return fail(res, 400, "verifier must be 64 hex characters");
      if (typeof body?.appPub !== "string" || !B64URL.test(body.appPub) || body.appPub.length > 64) return fail(res, 400, "appPub must be a base64url x25519 key");
      const label = typeof body?.label === "string" ? body.label.replace(/[^\p{L}\p{N} ._'-]/gu, "").slice(0, 60) : "";
      let id;
      do id = randomB32(10); while (store.sessions.has(id) || store.tunnels.has(id));
      const watch = randomBytes(32).toString("base64url");
      store.sessions.set(id, { id, createdAt: t, state: "waiting", vpsVerifier: body.verifier, watchVerifier: sha256hex(watch), appPub: body.appPub, label, events: [], seq: 0 });
      recent.push(t);
      created.set(ip, recent);
      store.save();
      return send(res, 201, { id, watch, expiresAt: t + 30 * 60_000, base, install: `curl -fsSL ${base}/i/` });
    }

    if ((parts = /^\/v1\/sessions\/([a-z2-7]{10})(?:\/(claim|events|result|probe))?$/.exec(path))) {
      const [, id, action] = parts;
      if (action === "claim" && method === "POST") {
        const session = vpsSession(req, res, id);
        if (!session) return;
        const body = await readJson(req);
        const host = body?.host && typeof body.host === "object"
          ? { arch: String(body.host.arch ?? "").slice(0, 20), os: String(body.host.os ?? "").slice(0, 60), name: String(body.host.name ?? "").slice(0, 60) } : null;
        if (session.state === "waiting") session.state = "installing";
        session.claimedAt ??= now();
        if (host) session.host = host;
        session.events.push({ seq: ++session.seq, at: now(), step: "claim", status: "done" });
        store.save();
        wakeSession(id);
        const build = packages.current();
        return send(res, 200, {
          ok: true, expiresAt: session.createdAt + SESSION_LIFE_MS, appPub: session.appPub, label: session.label,
          ...(build ? { package: { sha256: build.sha256, size: build.size, version: build.version, path: `/pkg/${id}/${build.sha256}.tgz` } } : {}),
          ...(build?.desktop ? { desktop: { sha256: build.desktop.sha256, size: build.desktop.size, image: build.desktop.image, path: `/pkg/${id}/${build.desktop.sha256}.tgz` } } : {}),
        });
      }
      if (action === "events" && method === "POST") {
        const session = vpsSession(req, res, id);
        if (!session) return;
        if (session.state === "waiting") return fail(res, 409, "claim first", "not_claimed");
        const body = await readJson(req);
        if (!STEP.test(body?.step ?? "") || !STATUSES.has(body?.status)) return fail(res, 400, "step and status are required");
        if (body.lines !== undefined && (!Array.isArray(body.lines) || body.lines.length > MAX_LINES || body.lines.some((line) => typeof line !== "string"))) {
          return fail(res, 400, `lines must be up to ${MAX_LINES} strings`);
        }
        const log = typeof body.log === "string" && body.log ? body.log.slice(-MAX_LOG) : undefined;
        const cmd = typeof body.cmd === "string" && body.cmd ? body.cmd.slice(0, MAX_CMD) : undefined;
        let lines;
        if (body.lines?.length) {
          let bytes = 0;
          lines = [];
          for (const line of body.lines.slice().reverse()) {
            const text = line.slice(0, MAX_LINE);
            if ((bytes += text.length) > MAX_LINES_BYTES) break;
            lines.unshift(text);
          }
        }
        // line batches are the many, short-lived events: past KEEP_LINE_EVENTS the oldest go first, status events stay
        if (lines) {
          const kept = session.events.filter((event) => event.lines);
          if (kept.length >= KEEP_LINE_EVENTS) { const drop = kept[0]; session.events.splice(session.events.indexOf(drop), 1); }
        }
        if (session.events.length >= MAX_EVENTS) session.events.splice(1, session.events.length - MAX_EVENTS + 1);
        const event = { seq: ++session.seq, at: now(), step: body.step, status: body.status, ...(log ? { log } : {}), ...(cmd ? { cmd } : {}), ...(lines ? { lines } : {}) };
        session.events.push(event);
        store.save();
        wakeSession(id);
        return send(res, 200, { seq: event.seq });
      }
      if (action === "probe" && method === "POST") {
        const session = vpsSession(req, res, id);
        if (!session) return;
        const body = await readJson(req);
        if (!NONCE.test(body?.nonce ?? "")) return fail(res, 400, "nonce must be 16-64 lowercase letters or digits");
        const ip = clientIp(req);
        if ((session.probes = (session.probes ?? 0) + 1) > 10) return fail(res, 429, "too many probes", "rate_limited");
        return send(res, 200, { ip, reachable: await probe(ip, body.nonce) });
      }
      if (action === "result" && method === "POST") {
        const session = vpsSession(req, res, id);
        if (!session) return;
        if (session.state === "waiting") return fail(res, 409, "claim first", "not_claimed");
        const body = await readJson(req);
        if (typeof body?.sealed !== "string" || !B64URL.test(body.sealed) || body.sealed.length > 16_384) return fail(res, 400, "sealed must be base64url");
        if (typeof body?.vpsPub !== "string" || !B64URL.test(body.vpsPub) || body.vpsPub.length > 64) return fail(res, 400, "vpsPub must be base64url");
        const tunnel = body?.tunnel;
        if (tunnel !== undefined && (!HEX64.test(tunnel?.vps ?? "") || !HEX64.test(tunnel?.app ?? ""))) return fail(res, 400, "tunnel verifiers must be 64 hex characters");
        if (tunnel) {
          if (store.tunnels.size >= MAX_TUNNELS) return fail(res, 503, "The link service is full.", "busy");
          store.tunnels.set(id, { id, createdAt: now(), vpsVerifier: tunnel.vps, appVerifier: tunnel.app, seenAt: null });
          session.tunnel = id;
        }
        session.state = "linked";
        session.endedAt = now();
        session.sealed = body.sealed;
        session.vpsPub = body.vpsPub;
        session.events.push({ seq: ++session.seq, at: now(), step: "link", status: "done" });
        store.save();
        wakeSession(id);
        return send(res, 200, { ok: true });
      }
      if (!action && method === "DELETE") {
        const session = appSession(req, res, id);
        if (!session) return;
        if (session.state !== "linked") { session.state = "cancelled"; session.endedAt = now(); store.save(); wakeSession(id); }
        return send(res, 200, { ok: true });
      }
      if (action === "events" && method === "GET") {
        const session = appSession(req, res, id);
        if (!session) return;
        const after = Math.max(0, Number.parseInt(url.searchParams.get("after") ?? "0", 10) || 0);
        const abort = new AbortController();
        res.on("close", () => abort.abort());
        if (/text\/event-stream/.test(String(req.headers.accept ?? ""))) return streamSession(res, session, after, abort.signal);
        const wait = Math.min(MAX_WAIT_S, Math.max(0, Number.parseInt(url.searchParams.get("wait") ?? "0", 10) || 0));
        const ended = () => ["linked", "cancelled", "expired"].includes(store.stateOf(session));
        if (wait && session.seq <= after && !ended()) await waitSession(id, wait * 1000, abort.signal);
        if (abort.signal.aborted) return;
        return send(res, 200, view(session, after));
      }
      return fail(res, 405, "method not allowed");
    }

    // the private server build and desktop kit: only for a claimed session that is still installing, with its own bearer token
    if (method === "GET" && (parts = /^\/pkg\/([a-z2-7]{10})\/([0-9a-f]{64})\.tgz$/.exec(path))) {
      const [, id, sha] = parts;
      const session = vpsSession(req, res, id);
      if (!session) return;
      if (session.state !== "installing") return fail(res, 409, "claim first", "not_claimed");
      const build = packages.find(sha);
      if (!build) return fail(res, 404, "not found", "not_found");
      if ((session.downloads = (session.downloads ?? 0) + 1) > PACKAGE_DOWNLOADS) return fail(res, 429, "too many downloads", "rate_limited");
      store.save();
      res.writeHead(200, { "content-type": "application/gzip", "content-length": String(build.size), "cache-control": "no-store, private", "x-content-type-options": "nosniff" });
      await pipeline(createReadStream(build.path), res).catch((error) => {
        // the server closing mid-download is normal (install.sh retries); anything else is ours
        if (error?.code !== "ERR_STREAM_PREMATURE_CLOSE") throw error;
      });
      return;
    }

    if ((parts = /^\/v1\/tunnels\/([a-z2-7]{10})(?:\/(to-vps|to-app|status))?$/.exec(path))) {
      const [, id, action] = parts;
      // either end may end it: the app forgetting the server, or uninstall.sh on the server with the vps token
      if (!action && method === "DELETE") {
        const tunnel = tunnelFor(req, res, id, "either");
        if (!tunnel) return;
        store.tunnels.delete(id);
        store.save();
        for (const dir of ["to-vps", "to-app"]) { queue(id, dir).wakeAll(); queues.delete(`${id}:${dir}`); }
        return send(res, 200, { ok: true });
      }
      if (action === "status" && method === "GET") {
        const tunnel = tunnelFor(req, res, id, "app");
        if (!tunnel) return;
        return send(res, 200, { seenAt: tunnel.seenAt ?? null });
      }
      if (action !== "to-vps" && action !== "to-app") return fail(res, 405, "method not allowed");
      // the app writes to-vps and reads to-app; the vps the other way round
      const writer = action === "to-vps" ? "app" : "vps";
      const role = method === "POST" ? writer : writer === "app" ? "vps" : "app";
      const tunnel = tunnelFor(req, res, id, role);
      if (!tunnel) return;
      if (role === "vps") { const t = now(); if (!tunnel.seenAt || t - tunnel.seenAt > 60_000) { tunnel.seenAt = t; store.save(); } else tunnel.seenAt = t; }
      if (method === "POST") {
        const body = await readJson(req, MAX_BODY);
        const frames = body?.frames;
        if (!Array.isArray(frames) || frames.length === 0 || frames.length > 256 || frames.some((frame) => typeof frame !== "string" || frame.length > FRAME_MAX || !B64URL.test(frame))) {
          return fail(res, 400, "frames must be 1-256 base64url strings");
        }
        if (!queue(id, action).push(frames)) return fail(res, 429, "the other side is behind; try again", "queue_full");
        return send(res, 200, { ok: true });
      }
      if (method === "GET") {
        const wait = Math.min(MAX_WAIT_S, Math.max(0, Number.parseInt(url.searchParams.get("wait") ?? "0", 10) || 0));
        const abort = new AbortController();
        res.on("close", () => abort.abort());
        const q = queue(id, action);
        if (wait && q.length === 0) await q.wait(wait * 1000, abort.signal);
        if (abort.signal.aborted || !store.tunnels.has(id)) return abort.signal.aborted ? undefined : fail(res, 404, "not found", "not_found");
        return send(res, 200, { frames: q.take() });
      }
      return fail(res, 405, "method not allowed");
    }

    return fail(res, 404, "not found");
  }

  async function streamSession(res, session, after, signal) {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no", connection: "keep-alive" });
    let sent = after;
    const beat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
    beat.unref?.();
    try {
      for (;;) {
        const current = view(session, sent);
        for (const event of current.events) res.write(`id: ${event.seq}\nevent: step\ndata: ${JSON.stringify(event)}\n\n`);
        sent = Math.max(sent, session.seq);
        const { events: _events, ...state } = current;
        res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
        if (["linked", "cancelled", "expired"].includes(current.state) || signal.aborted) break;
        await waitSession(session.id, MAX_WAIT_S * 1000, signal);
        if (signal.aborted) break;
      }
    } finally {
      clearInterval(beat);
      res.end();
    }
  }

  return {
    store,
    async handler(req, res) {
      try {
        await handle(req, res);
      } catch (error) {
        const status = typeof error?.status === "number" ? error.status : 500;
        if (status === 500) log(`link: ${error?.stack ?? error}`);
        if (!res.headersSent) fail(res, status, status === 500 ? "something went wrong" : error.message);
        else res.end();
      }
    },
    close() { store.close(); },
  };
}
