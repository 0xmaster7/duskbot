// the link service: (1) one-time setup sessions the app opens and the vps install script reports into, (2) the install
// and uninstall scripts and the agent, (3) a relay tunnel of frames both ends seal, so it never reads a request, a reply or a credential.
//
// trust: the app holds the secrets. the relay stores only sha256 verifiers of bearer tokens and passes sealed blobs on.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

import { createPackages } from "./packages.mjs";
import { createPushRelay } from "./push-relay.mjs";
import { slackCallback } from "./slack-callback.mjs";
import { MAX_CHANNELS_PER_TUNNEL, MAX_EVENTS, MAX_SESSIONS, MAX_TUNNELS, SESSION_LIFE_MS, createStore } from "./store.mjs";

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
/** a streamed line holds at most this much, so a lane frame queued a moment later waits behind one small line, not 4 MB */
const STREAM_LINE_BYTES = 256 * 1024;
/** the egress lane's own room: its frames are small (dials, answers, a page's first bytes) */
const LANE_FRAMES = 512;
const LANE_BYTES = 4 * 1024 * 1024;
const HELD_POSTS = 8;
const GAP_MS = 5000;
const EPOCH = /^[a-z2-7]{12}$/;
const CREATE_PER_HOUR = 30;
const CHANNEL_GRANT_MS = 24 * 60 * 60_000;
const PHONE_POSTS_PER_SECOND = 50;
const PHONE_POST_BURST = 400;
const PHONE_BYTES_PER_MINUTE = 64 * 1024 * 1024;
const PHONE_READS_PER_MINUTE = 240;
const LOOKUP_ID = /^[0-9a-f]{32}$/;
const LOOKUP_CREATE_PER_HOUR = 30;
const LOOKUP_MISSES_PER_HOUR = 60;
const MAX_LOOKUPS = 5000;
/** downloads (server build and desktop kit together) one install session may make; install.sh retries three times */
const PACKAGE_DOWNLOADS = 10;
const nonnegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;

function installerProgress(value) {
  if (!value || typeof value !== "object") return null;
  const label = typeof value.label === "string" ? [...value.label].filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join("").slice(0, 100) : undefined;
  if (value.kind === "download") {
    if (!nonnegativeInteger(value.receivedBytes) || (value.totalBytes !== undefined && !nonnegativeInteger(value.totalBytes))) return null;
    return { kind: value.kind, receivedBytes: value.receivedBytes, ...(value.totalBytes !== undefined ? { totalBytes: value.totalBytes } : {}), ...(label ? { label } : {}) };
  }
  if (value.kind !== "layers" && value.kind !== "build") return null;
  if (!nonnegativeInteger(value.completed) || !nonnegativeInteger(value.total) || value.completed > value.total) return null;
  const bytes = value.receivedBytes !== undefined || value.totalBytes !== undefined;
  if (bytes && (!nonnegativeInteger(value.receivedBytes) || !nonnegativeInteger(value.totalBytes))) return null;
  return { kind: value.kind, completed: value.completed, total: value.total,
    ...(bytes ? { receivedBytes: value.receivedBytes, totalBytes: value.totalBytes } : {}), ...(label ? { label } : {}) };
}

function installerActivity(value) {
  if (!value || !nonnegativeInteger(value.elapsedMs) || !nonnegativeInteger(value.quietMs) || value.quietMs > value.elapsedMs) return null;
  return { elapsedMs: value.elapsedMs, quietMs: value.quietMs };
}

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

/**
 * queues of sealed frames, one per direction per tunnel, with long-poll waiters. never persisted. a post marked `lane`
 * (egress: a bot's handshakes) is read out ahead of what waits in the main queue, in its own order.
 */
function frameQueue(onPush = () => {}) {
  const frames = [];
  const lane = [];
  let bytes = 0, laneBytes = 0, reader = 0, gap = null, reading = null;
  const waiters = new Set();
  const order = { epoch: null, next: 0, held: new Map(), retired: [] };
  function drainHeld() {
    while (order.held.has(order.next) && queue.push(order.held.get(order.next))) { order.held.delete(order.next); order.next += 1; }
    if (!order.held.size) { clearTimeout(gap); gap = null; }
  }
  function armGap() {
    if (gap) return;
    gap = setTimeout(() => {
      gap = null;
      if (!order.held.size) return;
      order.next = Math.min(...order.held.keys());
      drainHeld();
      if (order.held.size) armGap();
    }, GAP_MS);
    gap.unref?.();
  }
  const queue = {
    push(list, first = false) {
      const size = list.reduce((sum, frame) => sum + frame.length, 0);
      // the lane has room of its own: a main queue full of desktop frames never refuses a handshake
      if (first ? lane.length + list.length > LANE_FRAMES || laneBytes + size > LANE_BYTES : frames.length + list.length > QUEUE_FRAMES || bytes + size > QUEUE_BYTES) return false;
      if (first) { lane.push(...list); laneBytes += size; }
      else { frames.push(...list); bytes += size; }
      for (const wake of waiters) wake();
      waiters.clear();
      onPush();
      return true;
    },
    take(max = 256, maxBytes = 4 * 1024 * 1024) {
      const out = [];
      let size = 0;
      for (const from of [lane, frames]) {
        let count = 0, taken = 0;
        while (count < from.length && out.length + count < max && (out.length + count === 0 || size + from[count].length <= maxBytes)) { size += from[count].length; taken += from[count++].length; }
        out.push(...from.splice(0, count));
        if (from === lane) laneBytes -= taken; else bytes -= taken;
      }
      return out;
    },
    get length() { return frames.length + lane.length; },
    wait(ms, signal) {
      return new Promise((resolve) => {
        const done = () => { clearTimeout(timer); waiters.delete(done); signal?.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, ms);
        waiters.add(done);
        signal?.addEventListener("abort", done, { once: true });
      });
    },
    wakeAll() { for (const wake of waiters) wake(); waiters.clear(); },
    /**
     * a post numbered by its writer: frames join the queue in the writer's order even when posts overtake each other.
     * a new epoch is the writer restarted; a gap left by a post that never comes is skipped after a while.
     */
    pushInOrder(list, from, at) {
      if (from !== order.epoch) {
        if (order.retired.includes(from)) return true;
        if (order.epoch !== null) order.retired = [...order.retired.slice(-3), order.epoch];
        order.epoch = from;
        order.next = 0;
        order.held.clear();
      }
      if (at < order.next) return true;
      if (at > order.next) {
        if (order.held.size >= HELD_POSTS) return false;
        order.held.set(at, list);
        armGap();
        return true;
      }
      if (!queue.push(list)) return false;
      order.next += 1;
      drainHeld();
      return true;
    },
    /** one streamed reader per queue: a newer one (the same end, reconnected) ends the older */
    claim() { reading?.abort(); reading = new AbortController(); reader += 1; for (const wake of waiters) wake(); waiters.clear(); return reader; },
    get signal() { return reading?.signal; },
    holds: (turn) => turn === reader,
    close() { clearTimeout(gap); gap = null; order.held.clear(); reading?.abort(); reader += 1; queue.wakeAll(); },
  };
  return queue;
}

/**
 * @param {{
 *   base: string,
 *   dataDir?: string | null,
 *   scriptPath: string,
 *   uninstallPath?: string,
 *   agentPath: string,
 *   gatePath?: string,
 *   packagesDir?: string | null,
 *   trustProxy?: boolean,
 *   now?: () => number,
 *   fetch?: typeof fetch,
 *   log?: (line: string) => void,
 * }} options
 */
export function createLinkService({ base, dataDir = null, scriptPath, uninstallPath = join(dirname(scriptPath), "uninstall.sh"), agentPath, gatePath = join(dirname(agentPath), "docker-gate.mjs"), packagesDir, trustProxy = true, now = Date.now, fetch: fetchImpl = fetch, log = () => {}, push = createPushRelay({ log }) }) {
  const store = createStore({ dir: dataDir, now, onChannelDelete: clearChannel });
  const packages = createPackages(packagesDir !== undefined ? packagesDir : dataDir ? join(dataDir, "packages") : null);
  const sessionWaiters = new Map();
  const queues = new Map();
  const created = new Map();
  const cache = new Map();
  const channelReaders = new Map();
  const channelRates = new Map();
  const channelSeen = new Map();
  const lookups = new Map();
  const lookupCreated = new Map();
  const lookupMisses = new Map();
  const sweepStore = store.sweep;
  store.sweep = () => { sweepStore(); sweepLookups(); };

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
  const fail = (res, status, error, code, extra = {}) => send(res, status, { error, ...(code ? { code } : {}), ...extra });

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
    if (!found) queues.set(key, (found = frameQueue(() => {
      const channel = store.channels.get(tunnelId);
      if (dir === "to-vps" && channel) channelReaders.get(channel.tunnel)?.wakeAll();
    })));
    return found;
  }

  function clearQueues(id) {
    for (const dir of ["to-vps", "to-app"]) {
      const key = `${id}:${dir}`, q = queues.get(key);
      if (q) { q.wakeAll(); q.close(); queues.delete(key); }
    }
  }
  function clearChannel(channel) {
    clearQueues(channel.id);
    channelRates.delete(channel.id);
    channelSeen.delete(channel.id);
    channelReaders.get(channel.tunnel)?.wakeAll();
  }
  function deleteChannel(channel) {
    store.channels.delete(channel.id);
    clearChannel(channel);
    store.save();
  }
  function liveChannel(id) {
    const channel = store.channels.get(id);
    if (channel && ((channel.expiresAt != null && channel.expiresAt <= now()) || !store.tunnels.has(channel.tunnel))) { deleteChannel(channel); return null; }
    return channel;
  }
  function channelFor(req, res, id, tunnel = null) {
    const channel = liveChannel(id);
    if (!channel || (tunnel === null ? !sameHash(bearer(req), channel.verifier) : channel.tunnel !== tunnel)) {
      fail(res, 404, "not found", "not_found"); return null;
    }
    return channel;
  }
  function channelReader(id) {
    let q = channelReaders.get(id);
    if (!q) { q = frameQueue(); q.after = null; channelReaders.set(id, q); }
    return q;
  }
  function channelBatch(id, reader) {
    const list = [...store.channels.values()].filter((channel) => channel.tunnel === id);
    const start = (list.findIndex((channel) => channel.id === reader.after) + 1) % (list.length || 1);
    for (let i = 0; i < list.length; i += 1) {
      const channel = list[(start + i) % list.length];
      if (!liveChannel(channel.id)) continue;
      const q = queues.get(`${channel.id}:to-vps`);
      if (q?.length) { reader.after = channel.id; return { channel: channel.id, frames: q.take() }; }
    }
    return null;
  }
  function recent(map, id, ms) {
    const list = (map.get(id) ?? []).filter((at) => now() - at < ms);
    map.set(id, list);
    return list;
  }
  function phoneRate(res, channel, method, size = 0) {
    const t = now();
    let rate = channelRates.get(channel.id);
    if (!rate) { rate = { at: t, tokens: PHONE_POST_BURST, posts: [], reads: [] }; channelRates.set(channel.id, rate); }
    let ok;
    if (method === "POST") {
      rate.tokens = Math.min(PHONE_POST_BURST, rate.tokens + Math.max(0, t - rate.at) * PHONE_POSTS_PER_SECOND / 1000);
      rate.at = t;
      ok = rate.tokens >= 1;
      if (ok) rate.tokens -= 1;
    } else if (method === "BYTES") {
      rate.posts = rate.posts.filter((post) => t - post.at < 60_000);
      ok = rate.posts.reduce((sum, post) => sum + post.size, 0) + size <= PHONE_BYTES_PER_MINUTE;
      if (ok) rate.posts.push({ at: t, size });
    } else {
      rate.reads = rate.reads.filter((at) => t - at < 60_000);
      ok = rate.reads.length < PHONE_READS_PER_MINUTE;
      if (ok) rate.reads.push(t);
    }
    if (!ok) fail(res, 429, "too many channel requests", "rate_limited");
    return ok;
  }
  function sweepLookups() {
    const t = now();
    for (const [id, lookup] of lookups) if (lookup.expiresAt <= t) lookups.delete(id);
    for (const map of [lookupCreated, lookupMisses]) {
      for (const [ip, list] of map) {
        const kept = list.filter((at) => t - at < 3_600_000);
        if (kept.length) map.set(ip, kept); else map.delete(ip);
      }
    }
  }
  async function postFrames(req, res, id, dir, authorize, phone = false) {
    const body = await readJson(req, MAX_BODY);
    const channel = authorize();
    if (!channel) return;
    const frames = body?.frames;
    if (!Array.isArray(frames) || frames.length === 0 || frames.length > 256 || frames.some((frame) => typeof frame !== "string" || frame.length > FRAME_MAX || !B64URL.test(frame))) {
      return fail(res, 400, "frames must be 1-256 base64url strings");
    }
    if (phone && !phoneRate(res, channel, "BYTES", frames.reduce((sum, frame) => sum + frame.length, 0))) return;
    const ordered = typeof body.epoch === "string" && EPOCH.test(body.epoch) && Number.isSafeInteger(body.seq) && body.seq >= 0;
    const q = queue(id, dir);
    if (!(ordered ? q.pushInOrder(frames, body.epoch, body.seq) : q.push(frames, body.lane === true))) return fail(res, 429, "the other side is behind; try again", "queue_full");
    return send(res, 200, { ok: true, ordered: true });
  }

  function vpsSession(req, res, id) {
    const session = store.sessions.get(id);
    if (!session) { fail(res, 404, "This command expired. Make a new one in the app.", "expired"); return null; }
    if (!sameHash(bearer(req), session.vpsVerifier)) { fail(res, 401, "This command is not valid.", "unauthorized"); return null; }
    const state = store.stateOf(session);
    if (state === "cancelled") { fail(res, 410, "Setup was cancelled in the app. Make a new command to resume.", "cancelled"); return null; }
    if (state === "linked") { fail(res, 410, "This command was already used. Make a new one in the app.", "used"); return null; }
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

    if (method === "GET" && path === "/.well-known/openmausbot/dashboard") {
      const dashboard = process.env.OMB_LINK_DASHBOARD_URL;
      return dashboard ? send(res, 200, { v: 1, url: dashboard }) : fail(res, 404, "No account dashboard is configured.");
    }
    if (method === "GET" && path === "/healthz") return send(res, 200, { ok: true });
    if (method === "GET" && path === "/v1/ip") return send(res, 200, { ip: clientIp(req) });
    if (method === "GET" && path === "/slack/callback") return slackCallback(res, url.searchParams);
    if (path === "/v1/push") return push.route(req, res, { method, readJson, send, fail, ip: clientIp(req) });
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
    // what a linked server's agent updates itself to (apps/link-service/agent.mjs createUpdater): the agent served at /agent.mjs
    if (method === "GET" && path === "/v1/release") {
      const text = file(agentPath);
      const version = /^export const AGENT_VERSION = "(\d+\.\d+\.\d+)";$/m.exec(text)?.[1];
      const protocol = Number(/^export const LINK_PROTOCOL = (\d+);$/m.exec(text)?.[1]);
      if (!version || !Number.isInteger(protocol)) return fail(res, 404, "no release");
      const sig = existsSync(`${agentPath}.sig`) ? file(`${agentPath}.sig`).trim() : null;
      res.setHeader("cache-control", "no-store");
      return send(res, 200, { v: 1, agent: { version, protocol, sha256: createHash("sha256").update(text).digest("hex") }, ...(sig ? { sig } : {}) });
    }
    if (method === "GET" && (path === "/agent.mjs" || path === "/docker-gate.mjs")) {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      return res.end(file(path === "/agent.mjs" ? agentPath : gatePath));
    }

    if (path === "/v1/lookups" || (parts = /^\/v1\/lookups\/([0-9a-f]{32})$/.exec(path))) {
      sweepLookups();
      const id = parts?.[1], ip = clientIp(req);
      if (!id && method === "POST") {
        if (recent(lookupCreated, ip, 3_600_000).length >= LOOKUP_CREATE_PER_HOUR) return fail(res, 429, "too many lookups", "rate_limited");
        const body = await readJson(req);
        if (typeof body?.id !== "string" || !LOOKUP_ID.test(body.id) || typeof body.sealed !== "string" || !B64URL.test(body.sealed) || body.sealed.length > 16_384
          || !Number.isInteger(body.ttlS) || body.ttlS < 30 || body.ttlS > 900 || (body.deleteVerifier !== undefined && (typeof body.deleteVerifier !== "string" || !HEX64.test(body.deleteVerifier)))) {
          return fail(res, 400, "invalid lookup");
        }
        sweepLookups();
        const list = recent(lookupCreated, ip, 3_600_000);
        if (list.length >= LOOKUP_CREATE_PER_HOUR) return fail(res, 429, "too many lookups", "rate_limited");
        if (lookups.has(body.id)) return fail(res, 409, "lookup id is taken", "taken");
        if (lookups.size >= MAX_LOOKUPS) return fail(res, 503, "The link service is busy. Try again in a minute.", "busy");
        const expiresAt = now() + body.ttlS * 1000;
        lookups.set(body.id, { sealed: body.sealed, expiresAt, deleteVerifier: body.deleteVerifier });
        list.push(now());
        return send(res, 201, { ok: true, expiresAt });
      }
      const lookup = lookups.get(id);
      if (id && method === "GET") {
        if (lookup) return send(res, 200, { sealed: lookup.sealed, expiresAt: lookup.expiresAt });
        const list = recent(lookupMisses, ip, 3_600_000);
        if (list.length >= LOOKUP_MISSES_PER_HOUR) return fail(res, 429, "too many lookup misses", "rate_limited");
        list.push(now());
        return fail(res, 404, "not found", "not_found");
      }
      if (id && method === "DELETE") {
        if (!lookup || !sameHash(bearer(req), lookup.deleteVerifier)) return fail(res, 404, "not found", "not_found");
        lookups.delete(id);
        return send(res, 200, { ok: true });
      }
      return fail(res, 405, "method not allowed");
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
      do id = randomB32(10); while (store.sessions.has(id) || store.tunnels.has(id) || store.channels.has(id));
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
        if (!vpsSession(req, res, id)) return;
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
        if (!vpsSession(req, res, id)) return;
        if (!STEP.test(body?.step ?? "") || !STATUSES.has(body?.status)) return fail(res, 400, "step and status are required");
        const progress = body.progress === undefined ? undefined : installerProgress(body.progress);
        const activity = body.activity === undefined ? undefined : installerActivity(body.activity);
        if (progress === null || activity === null || (body.heartbeat !== undefined && typeof body.heartbeat !== "boolean")) return fail(res, 400, "invalid installer progress or activity");
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
        if (lines || progress || activity || body.heartbeat) {
          const kept = session.events.filter((event) => event.lines || event.progress || event.activity || event.heartbeat);
          if (kept.length >= KEEP_LINE_EVENTS) { const drop = kept[0]; session.events.splice(session.events.indexOf(drop), 1); }
        }
        if (session.events.length >= MAX_EVENTS) session.events.splice(1, session.events.length - MAX_EVENTS + 1);
        const event = { seq: ++session.seq, at: now(), step: body.step, status: body.status, ...(log ? { log } : {}), ...(cmd ? { cmd } : {}), ...(lines ? { lines } : {}),
          ...(progress ? { progress } : {}), ...(activity ? { activity } : {}), ...(body.heartbeat ? { heartbeat: true } : {}) };
        session.events.push(event);
        store.save();
        wakeSession(id);
        return send(res, 200, { seq: event.seq });
      }
      if (action === "probe" && method === "POST") {
        const session = vpsSession(req, res, id);
        if (!session) return;
        const body = await readJson(req);
        if (!vpsSession(req, res, id)) return;
        if (!NONCE.test(body?.nonce ?? "")) return fail(res, 400, "nonce must be 16-64 lowercase letters or digits");
        const ip = clientIp(req);
        if ((session.probes = (session.probes ?? 0) + 1) > 10) return fail(res, 429, "too many probes", "rate_limited");
        const reachable = await probe(ip, body.nonce);
        if (!vpsSession(req, res, id)) return;
        return send(res, 200, { ip, reachable });
      }
      if (action === "result" && method === "POST") {
        const session = vpsSession(req, res, id);
        if (!session) return;
        if (session.state === "waiting") return fail(res, 409, "claim first", "not_claimed");
        const body = await readJson(req);
        if (!vpsSession(req, res, id)) return;
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
      const range = req.headers.range;
      const match = typeof range === "string" ? /^bytes=(0|[1-9][0-9]*)-$/.exec(range) : null;
      const start = range === undefined ? 0 : match ? Number(match[1]) : NaN;
      if (!nonnegativeInteger(start) || start >= build.size) return send(res, 416, { error: "invalid package range" }, { "content-range": `bytes */${build.size}` });
      if ((session.downloads = (session.downloads ?? 0) + 1) > PACKAGE_DOWNLOADS) return fail(res, 429, "too many downloads", "rate_limited");
      store.save();
      res.writeHead(range === undefined ? 200 : 206, { "content-type": "application/gzip", "content-length": String(build.size - start), "accept-ranges": "bytes",
        ...(range === undefined ? {} : { "content-range": `bytes ${start}-${build.size - 1}/${build.size}` }), "cache-control": "no-store, private", "x-content-type-options": "nosniff" });
      await pipeline(createReadStream(build.path, { start }), res).catch((error) => {
        // the server closing mid-download is normal (install.sh retries); anything else is ours
        if (error?.code !== "ERR_STREAM_PREMATURE_CLOSE") throw error;
      });
      return;
    }

    if ((parts = /^\/v1\/tunnels\/([a-z2-7]{10})\/channels(?:\/(to-vps)|\/([a-z2-7]{10})\/to-app)?$/.exec(path))) {
      const [, id, aggregate, cid] = parts;
      if (!tunnelFor(req, res, id, "vps")) return;
      if (!aggregate && !cid && method === "PUT") {
        const body = await readJson(req);
        if (!tunnelFor(req, res, id, "vps")) return;
        const list = body?.channels, t = now(), ids = new Set();
        if (!Array.isArray(list) || list.length > MAX_CHANNELS_PER_TUNNEL) return fail(res, 400, "invalid channels");
        for (const channel of list) {
          if (typeof channel?.id !== "string" || !ID.test(channel.id) || ids.has(channel.id) || typeof channel.verifier !== "string" || !HEX64.test(channel.verifier)
            || (channel.kind !== "grant" && channel.kind !== "device")
            || (channel.kind === "grant" ? !Number.isSafeInteger(channel.expiresAt) || channel.expiresAt <= t || channel.expiresAt > t + CHANNEL_GRANT_MS : channel.expiresAt != null)) {
            return fail(res, 400, "invalid channel");
          }
          ids.add(channel.id);
        }
        for (const channel of list) {
          if (store.sessions.has(channel.id) || store.tunnels.has(channel.id) || (store.channels.has(channel.id) && store.channels.get(channel.id).tunnel !== id)) {
            return fail(res, 409, "channel id is taken", "taken", { id: channel.id });
          }
        }
        for (const channel of store.channels.values()) if (channel.tunnel === id && !ids.has(channel.id)) deleteChannel(channel);
        for (const channel of list) {
          const kept = store.channels.get(channel.id);
          if (kept) {
            if (kept.verifier !== channel.verifier) clearQueues(channel.id);
            Object.assign(kept, { verifier: channel.verifier, kind: channel.kind, expiresAt: channel.expiresAt ?? null });
          } else store.channels.set(channel.id, { id: channel.id, tunnel: id, verifier: channel.verifier, kind: channel.kind, expiresAt: channel.expiresAt ?? null, createdAt: t, seenAt: null });
        }
        store.save();
        channelReaders.get(id)?.wakeAll();
        return send(res, 200, { ok: true, channels: list.length });
      }
      if (cid && method === "POST") {
        const authorize = () => tunnelFor(req, res, id, "vps") && channelFor(req, res, cid, id);
        if (!channelFor(req, res, cid, id)) return;
        return postFrames(req, res, cid, "to-app", authorize);
      }
      if (aggregate && method === "GET") {
        const wait = Math.min(MAX_WAIT_S, Math.max(0, Number.parseInt(url.searchParams.get("wait") ?? "0", 10) || 0));
        const abort = new AbortController();
        res.on("close", () => abort.abort());
        const reader = channelReader(id), turn = reader.claim();
        if (wait && url.searchParams.get("stream") === "1") return streamChannels(res, id, reader, turn, wait * 1000, abort.signal);
        const until = Date.now() + wait * 1000;
        let batch;
        while (!abort.signal.aborted && reader.holds(turn) && store.tunnels.has(id) && !(batch = channelBatch(id, reader))) {
          const left = until - Date.now();
          if (left <= 0) break;
          await reader.wait(left, abort.signal);
        }
        if (abort.signal.aborted) return;
        if (!store.tunnels.has(id)) return fail(res, 404, "not found", "not_found");
        const batches = [];
        if (batch) {
          batches.push(batch);
          const seen = new Set([batch.channel]);
          for (const channel of store.channels.values()) {
            if (channel.tunnel !== id || seen.has(channel.id) || !liveChannel(channel.id)) continue;
            const q = queues.get(`${channel.id}:to-vps`);
            if (q?.length) batches.push({ channel: channel.id, frames: q.take() });
          }
        }
        return send(res, 200, { batches });
      }
      return fail(res, 405, "method not allowed");
    }

    if ((parts = /^\/v1\/channels\/([a-z2-7]{10})(?:\/(to-vps|to-app))?$/.exec(path))) {
      const [, id, action] = parts;
      const channel = channelFor(req, res, id);
      if (!channel) return;
      if (!action && method === "DELETE") { deleteChannel(channel); return send(res, 200, { ok: true }); }
      if (action === "to-vps" && method === "POST") {
        if (!phoneRate(res, channel, "POST")) return;
        return postFrames(req, res, id, action, () => channelFor(req, res, id), true);
      }
      if (action === "to-app" && method === "GET") {
        if (!phoneRate(res, channel, "GET")) return;
        const t = now();
        channel.seenAt = t;
        if (!channelSeen.has(id) || t - channelSeen.get(id) >= 60_000) { channelSeen.set(id, t); store.save(); }
        const wait = Math.min(MAX_WAIT_S, Math.max(0, Number.parseInt(url.searchParams.get("wait") ?? "0", 10) || 0));
        const ms = Math.min(wait * 1000, channel.expiresAt == null ? Infinity : Math.max(0, channel.expiresAt - t));
        const abort = new AbortController();
        res.on("close", () => abort.abort());
        const q = queue(id, action), verifier = channel.verifier;
        const alive = () => liveChannel(id)?.verifier === verifier;
        if (wait && url.searchParams.get("stream") === "1") return streamFrames(res, id, q, ms, abort.signal, alive);
        if (wait && q.length === 0) await q.wait(ms, abort.signal);
        if (abort.signal.aborted) return;
        if (!alive() || queues.get(`${id}:${action}`) !== q) return fail(res, 404, "not found", "not_found");
        return send(res, 200, { frames: q.take() });
      }
      return fail(res, 405, "method not allowed");
    }

    if ((parts = /^\/v1\/tunnels\/([a-z2-7]{10})(?:\/(to-vps|to-app|status))?$/.exec(path))) {
      const [, id, action] = parts;
      // either end may end it: the app forgetting the server, or uninstall.sh on the server with the vps token
      if (!action && method === "DELETE") {
        const tunnel = tunnelFor(req, res, id, "either");
        if (!tunnel) return;
        store.tunnels.delete(id);
        for (const channel of store.channels.values()) if (channel.tunnel === id) deleteChannel(channel);
        channelReaders.get(id)?.close();
        channelReaders.delete(id);
        store.save();
        clearQueues(id);
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
        const ordered = typeof body.epoch === "string" && EPOCH.test(body.epoch) && Number.isSafeInteger(body.seq) && body.seq >= 0;
        const q = queue(id, action);
        if (!(ordered ? q.pushInOrder(frames, body.epoch, body.seq) : q.push(frames, body.lane === true))) return fail(res, 429, "the other side is behind; try again", "queue_full");
        return send(res, 200, { ok: true, ordered: true });
      }
      if (method === "GET") {
        const wait = Math.min(MAX_WAIT_S, Math.max(0, Number.parseInt(url.searchParams.get("wait") ?? "0", 10) || 0));
        const abort = new AbortController();
        res.on("close", () => abort.abort());
        const q = queue(id, action);
        if (wait && url.searchParams.get("stream") === "1") return streamFrames(res, id, q, wait * 1000, abort.signal);
        if (wait && q.length === 0) await q.wait(wait * 1000, abort.signal);
        if (abort.signal.aborted || !store.tunnels.has(id)) return abort.signal.aborted ? undefined : fail(res, 404, "not found", "not_found");
        return send(res, 200, { frames: q.take() });
      }
      return fail(res, 405, "method not allowed");
    }

    return fail(res, 404, "not found");
  }

  /** a long poll that stays open: each batch of frames goes out as one json line the moment it is queued */
  async function streamFrames(res, id, q, ms, signal, alive = () => store.tunnels.has(id)) {
    const turn = q.claim();
    signal = AbortSignal.any([signal, q.signal, AbortSignal.timeout(ms)]);
    const until = Date.now() + ms;
    res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-accel-buffering": "no" });
    let first = true;
    try {
      while (!signal.aborted && q.holds(turn) && alive() && Date.now() < until) {
        if (!first && q.length === 0) {
          const left = until - Date.now();
          if (left <= 0) break;
          await q.wait(left, signal);
          continue;
        }
        first = false;
        await writeLine(res, { frames: q.take(256, STREAM_LINE_BYTES) }, signal);
      }
    } finally { res.end(); }
  }

  async function streamChannels(res, id, reader, turn, ms, signal) {
    signal = AbortSignal.any([signal, reader.signal, AbortSignal.timeout(ms)]);
    const until = Date.now() + ms;
    res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-accel-buffering": "no" });
    try {
      await writeLine(res, { frames: [] }, signal);
      while (!signal.aborted && reader.holds(turn) && store.tunnels.has(id) && Date.now() < until) {
        const batch = channelBatch(id, reader);
        if (batch) await writeLine(res, batch, signal);
        else await reader.wait(Math.max(1, until - Date.now()), signal);
      }
    } finally { res.end(); }
  }
  async function writeLine(res, body, signal) {
    if (!res.write(`${JSON.stringify(body)}\n`)) {
      await new Promise((resolve) => {
        const done = () => { res.off("drain", done); signal.removeEventListener("abort", done); resolve(); };
        res.once("drain", done);
        signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      });
    }
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
    close() { for (const q of queues.values()) q.close(); for (const q of channelReaders.values()) q.close(); store.close(); },
  };
}
