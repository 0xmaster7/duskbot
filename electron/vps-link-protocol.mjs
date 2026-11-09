// the app's half of linking a vps (apps/link-service/agent.mjs is the server's half; the crypto block is the same in both and
// a test proves they interoperate). the link service only ever sees verifiers, public keys and sealed blobs.
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import { Agent as HttpAgent, STATUS_CODES, createServer, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { connect as http2Connect, constants as h2Constants } from "node:http2";
import { connect as netConnect, isIP } from "node:net";
import { Readable } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import { setTimeout as sleep } from "node:timers/promises";

import { createDirectLink } from "./vps-link-direct.mjs";
import { clampMss } from "./tcp-clamp.mjs";

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
const FRAME_SKEW_MS = 5 * 60_000;
const CHUNK = 128 * 1024;
/** one post stays well under a proxy's usual 1 MB body limit (nginx's default) */
const BATCH_BYTES = 700 * 1024;

/** a websocket's bytes wait here at most this much before its socket is paused (the link service queues 16 MB a side) */
const STREAM_HIGH = 2 * 1024 * 1024;
const STREAM_LOW = 512 * 1024;
const RECEIVE_HIGH = 8 * 1024 * 1024;
/** posts out at once once the relay says it puts them back in order (one before it does) */
const POSTS_IN_FLIGHT = 3;
/** how long a frame that comes while posts are out waits for more, per post out, and at most */
const GATHER_MS = 2;
const GATHER_MAX_MS = 16;
/** over http/1.1 (three posts out) every post waits this long for company first, as it always did */
const H1_POST_DELAY_MS = 5;
/**
 * frames waiting for the one post in flight (kept in step with the other end of the tunnel). a stream's bytes join its
 * last waiting piece and are sealed only when sent, so a busy websocket costs a few frames per post, not one per chunk.
 */
export function createOutbox({ seal: sealRaw, post, delayMs, signal, onError = () => {}, parallel = () => 1 }) {
  const streams = new Map();
  const drains = new Set();
  let flushing = null, queued = 0, seq = 0, nudge = null;
  const release = () => { const waiting = [...drains]; drains.clear(); for (const resume of waiting) resume(); };
  const clear = () => { streams.clear(); queued = 0; };
  /**
   * with nothing out, frames pushed in the same turn share a post that leaves at once (delay 0). frames that come while
   * posts are out wait a little for company, longer the more are out, so a burst spread over a few milliseconds (a page's
   * twenty requests) fills a few posts instead of taking every slot and waiting a round trip for the rest. `delayMs` may
   * be a function: with only three posts out at once (http/1.1) a fixed wait before every post keeps more slots free
   */
  const gather = (outstanding) => {
    const fixed = typeof delayMs === "function" ? delayMs() : delayMs;
    if (fixed > 0) return sleep(fixed, undefined, { signal });
    return outstanding ? sleep(Math.min(GATHER_MAX_MS, GATHER_MS * outstanding), undefined, { signal }) : new Promise((resolve) => setImmediate(resolve));
  };
  signal?.addEventListener("abort", () => { clear(); release(); }, { once: true });
  function stream(r) {
    let items = streams.get(r);
    if (!items) streams.set(r, (items = []));
    return items;
  }
  function batch() {
    const frames = [];
    let size = 0;
    for (;;) {
      let progressed = false;
      const round = [...streams];
      for (const [r, items] of round) {
        const item = items[0];
        if (!item.sealed) {
          item.sealed = sealRaw(r, item.parts.length === 1 ? item.parts[0] : Buffer.concat(item.parts));
          queued += item.sealed.length - item.size;
          item.size = item.sealed.length;
          delete item.parts;
        }
        if (frames.length && size + item.size > BATCH_BYTES) continue;
        frames.push(item.sealed);
        size += item.size;
        queued -= item.size;
        items.shift();
        streams.delete(r);
        if (items.length) streams.set(r, items);
        progressed = true;
        if (frames.length === 64) return frames;
      }
      if (!progressed || !streams.size) return frames;
    }
  }
  /** posts carry a sequence number, so a relay that orders them lets several be in flight at once */
  function kick() {
    if (flushing) nudge?.();
    if (flushing || signal?.aborted) return;
    flushing = (async () => {
      try {
        await gather(0);
        const out = new Set();
        let failed = null;
        while ((streams.size || out.size) && !signal?.aborted) {
          while (streams.size && out.size < parallel() && !signal?.aborted) {
            const frames = batch(), at = seq++;
            const sending = Promise.resolve().then(() => post(frames, at))
              .then((ok) => { if (ok === false) clear(); if (drains.size && queued < STREAM_LOW) release(); }, (error) => { failed ??= error; })
              .finally(() => out.delete(sending));
            out.add(sending);
          }
          if (out.size) {
            // new frames while posts are out go in a free slot without waiting for one of them to come back
            const nudged = await new Promise((resolve) => { nudge = () => resolve(true); for (const sending of out) void sending.then(() => resolve(false)); });
            nudge = null;
            if (nudged) await gather(out.size);
          }
          if (failed) throw failed;
        }
      } catch (error) {
        clear();
        if (!signal?.aborted) onError(error);
      } finally {
        flushing = null;
        release();
      }
    })();
  }
  return {
    discard(r) {
      const items = streams.get(r);
      if (!items) return;
      for (const item of items) queued -= item.size;
      streams.delete(r);
      if (queued < STREAM_LOW) release();
    },
    push(sealed, r = "") {
      if (signal?.aborted) return;
      stream(r).push({ sealed, size: sealed.length });
      queued += sealed.length;
      kick();
    },
    /** false: stop reading this stream until `onDrain` calls back */
    bytes(r, chunk) {
      if (signal?.aborted) return true;
      const items = stream(r);
      const last = items[items.length - 1];
      if (last?.parts && last.size + chunk.length <= CHUNK) { last.parts.push(chunk); last.size += chunk.length; }
      else for (let at = 0; at < chunk.length; at += CHUNK) {
        const part = chunk.subarray(at, at + CHUNK);
        items.push({ parts: [part], size: part.length });
      }
      queued += chunk.length;
      kick();
      return queued < STREAM_HIGH;
    },
    onDrain(resume) { if (signal?.aborted || queued < STREAM_LOW) resume(); else drains.add(resume); },
    get size() { return queued; },
  };
}

const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "content-length", "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "forwarded"]);

export function randomB32(length) {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += B32[bytes[i] & 31];
  return out;
}

// ---- crypto shared with apps/link-service/agent.mjs ----
export const sha256hex = (value) => createHash("sha256").update(value).digest("hex");
export const vpsTokenOf = (secret) => sha256hex(`omb-link-v1|vps|${secret}`);
export function x25519Pair() {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return { pub: publicKey.export({ format: "jwk" }).x, priv: privateKey.export({ format: "jwk" }).d };
}
export function sealKeyOf(myPriv, myPub, theirPub, id) {
  const privateKey = createPrivateKey({ key: { kty: "OKP", crv: "X25519", d: myPriv, x: myPub }, format: "jwk" });
  const publicKey = createPublicKey({ key: { kty: "OKP", crv: "X25519", x: theirPub }, format: "jwk" });
  return Buffer.from(hkdfSync("sha256", diffieHellman({ privateKey, publicKey }), `omb-link-v1|${id}`, "seal", 32));
}
/** iv, ciphertext, tag: as bytes for the direct link, as base64url for the relay's json */
export function sealRaw(key, aad, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]);
}
export const seal = (key, aad, plaintext) => sealRaw(key, aad, plaintext).toString("base64url");
export function open(key, aad, sealed) {
  const raw = typeof sealed === "string" ? Buffer.from(sealed, "base64url") : sealed;
  if (raw.length < 29) throw new Error("sealed value too short");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
}
/** frames carry their time and are refused twice or when stale, so a relay cannot replay an old request */
export function frameGuard(now = Date.now) {
  const seen = new Map();
  return (iv, ts) => {
    const t = now();
    if (typeof ts !== "number" || Math.abs(t - ts) > FRAME_SKEW_MS) return false;
    if (seen.has(iv)) return false;
    seen.set(iv, t);
    // oldest first, so a busy stream prunes a few entries per frame instead of walking them all
    for (const [key, at] of seen) { if (t - at <= 2 * FRAME_SKEW_MS) break; seen.delete(key); }
    return true;
  };
}
export function sealFrame(key, id, dir, frame, raw = false) {
  return (raw ? sealRaw : seal)(key, `${id}|${dir}`, Buffer.from(JSON.stringify({ ...frame, ts: Date.now() })));
}
/** a websocket's bytes travel raw, not as base64 in json: 0x01, the 12-letter stream id, the time, then the bytes */
export function sealBytes(key, id, dir, r, bytes, raw = false) {
  const head = Buffer.alloc(21);
  head[0] = 1;
  head.write(r, 1, 12, "latin1");
  head.writeDoubleBE(Date.now(), 13);
  return (raw ? sealRaw : seal)(key, `${id}|${dir}`, Buffer.concat([head, bytes]));
}
/**
 * `sealed` is base64url (relay) or bytes (direct); the guard keys on the iv either way. each end keeps one guard for
 * every path: on the vps the tunnel process serves the relay and every direct connection with the same one (only a
 * direct command that found no tunnel to hand its connection to keeps its own)
 */
export function openFrame(key, id, dir, sealed, guard) {
  const plain = open(key, `${id}|${dir}`, sealed);
  const value = plain[0] === 1 && plain.length >= 21
    ? { t: "bytes", r: plain.toString("latin1", 1, 13), ts: plain.readDoubleBE(13), b: plain.subarray(21) }
    : JSON.parse(plain.toString("utf8"));
  if (guard && !guard(typeof sealed === "string" ? sealed.slice(0, 16) : sealed.subarray(0, 12).toString("base64url"), value.ts)) return null;
  return value;
}
// ---- end shared crypto ----

// ---- relay transport shared with apps/link-service/agent.mjs ----
/** how long a streamed read may stay silent before this end decides a proxy holds the lines back and polls instead */
export const STREAM_STALL_MS = 5000;
const STREAM_OFF_MS = 10 * 60_000;
/**
 * a streamed read lasts 25 s (wait=25). the next one goes out this long into it, so it reaches the relay first and takes
 * over (the relay ends the older reader then): a frame never waits through a gap of a round trip between two reads
 */
const STREAM_AHEAD_MS = 21_000;
const WARM_MS = 40_000;

/**
 * fetch over node's own http(s) with its sockets kept open. the global fetch closes an idle socket after 4 s (undici's
 * default), so every reply after a pause paid a new tcp and tls handshake to the link service, and a cold tcp window.
 */
export function keepAliveFetch({ maxSockets = 8, tls = {} } = {}) {
  const agents = new Map();
  let lastUsed = 0;
  const agentFor = (protocol) => {
    let found = agents.get(protocol);
    if (!found) agents.set(protocol, (found = new (protocol === "https:" ? HttpsAgent : HttpAgent)({ keepAlive: true, keepAliveMsecs: 15_000, maxSockets, scheduling: "lifo", ...(protocol === "https:" ? tls : {}) })));
    return found;
  };
  const go = (input, init = {}) => new Promise((resolve, reject) => {
    const url = new URL(input);
    const { signal } = init;
    if (signal?.aborted) { reject(signal.reason); return; }
    lastUsed = Date.now();
    const body = init.body == null ? null : Buffer.from(init.body);
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const stop = () => req.destroy(signal.reason);
    const req = send(url, { method: init.method ?? "GET", headers: { ...init.headers, ...(body ? { "content-length": body.length } : {}) }, agent: agentFor(url.protocol) }, (res) => {
      res.once("close", () => signal?.removeEventListener("abort", stop));
      const headers = new Headers();
      for (const [name, value] of Object.entries(res.headers)) for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
      const empty = res.statusCode === 204 || res.statusCode === 205 || res.statusCode === 304 || init.method === "HEAD";
      if (empty) res.resume();
      resolve(new Response(empty ? null : Readable.toWeb(res), { status: res.statusCode, headers }));
    });
    signal?.addEventListener("abort", stop, { once: true });
    req.once("error", (error) => { signal?.removeEventListener("abort", stop); reject(error); });
    // a new connection's handshake can take seconds (a vpn); `onConnected` says when the request is really on its way
    if (init.onConnected) req.once("socket", (socket) => { if (req.reusedSocket || !socket.connecting) init.onConnected(); else socket.once(url.protocol === "https:" ? "secureConnect" : "connect", init.onConnected); });
    req.end(body);
  });
  go.connectAware = true;
  /** a spare socket stays open: nginx closes one idle for 75 s, and the long poll holds the other */
  go.warm = (base, wanted = () => true) => {
    const timer = setInterval(() => {
      if (!wanted() || Date.now() - lastUsed < WARM_MS - 5000) return;
      void go(`${base}/healthz`, { signal: AbortSignal.timeout(10_000) }).then((response) => response.text()).catch(() => {});
    }, WARM_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  };
  go.close = () => { for (const agent of agents.values()) agent.destroy(); agents.clear(); };
  /**
   * after a sleep or a network change: every socket may be dead, so the next requests open fresh ones. the agents stay
   * with their tls sessions, so those connections resume instead of a full handshake (no certificate flight: behind a
   * vpn that drops full-size packets a full handshake to the relay took 5.5 s and a resumed one 0.8 s)
   */
  go.reset = () => { for (const agent of agents.values()) agent.destroy(); };
  return go;
}

/** an http/2 stream's own window and the connection's: a whole desktop frame or download in flight at a long round trip */
const H2_STREAM_WINDOW = 4 * 1024 * 1024;
const H2_SESSION_WINDOW = 8 * 1024 * 1024;
/** a request that never reached the relay: the connection was closing (goaway), gone, or refused the stream */
const H2_UNSENT = new Set(["ERR_HTTP2_GOAWAY_SESSION", "ERR_HTTP2_INVALID_SESSION", "ERR_HTTP2_REFUSED_STREAM"]);
/** posts out at once over http/2: as many as the relay holds while an earlier one is still on its way (HELD_POSTS) */
const H2_POSTS_IN_FLIGHT = 8;
const H2_DIAL_MS = 20_000;
/**
 * a request with no answer this long has its connection prove itself with a ping, and one that does not answer the ping
 * in H2_PING_MS is dropped so the next request dials afresh. a connection can die without a word (a phone hotspot or
 * vpn that changed under it): the app sat 20 minutes on one with every post and read timing out (2026-11-08)
 */
const H2_CHECK_MS = 10_000;
const H2_PING_MS = 10_000;
const until = (promise, signal) => (!signal ? promise : new Promise((resolve, reject) => {
  const stop = () => reject(signal.reason);
  signal.addEventListener("abort", stop, { once: true });
  promise.then((value) => { signal.removeEventListener("abort", stop); resolve(value); }, (error) => { signal.removeEventListener("abort", stop); reject(error); });
}));

/**
 * keepAliveFetch's api over one http/2 connection when the relay offers h2 (nginx does): the streamed read and every
 * post share one warm tls connection, so a post never waits on a new handshake (5.5 s behind a lossy vpn, 0.3 s from a
 * vps) and many can be out at once (`multiplexed()`). plain http, or an origin that answers without h2, goes through
 * keepAliveFetch. `tls` is extra tls.connect options (a test's ca); `dial(host, port)` makes the tcp socket under it.
 */
export function relayFetch({ tls: tlsOptions = {}, maxSockets = 8, dial = null, checkMs = H2_CHECK_MS, pingMs = H2_PING_MS } = {}) {
  const h1 = keepAliveFetch({ maxSockets, tls: tlsOptions });
  const h1Origins = new Set();
  let session = null, opening = null, tlsSession = null, lastUsed = 0, checking = null;
  const live = (one) => Boolean(one && !one.closed && !one.destroyed);
  /** a ping answered keeps the connection; none in time drops it, failing what is on it so the callers ask again */
  const check = (one) => {
    if (checking === one || !live(one)) return;
    checking = one;
    const dead = () => { if (checking === one) checking = null; if (session === one) session = null; one.destroy(); };
    const timer = setTimeout(dead, pingMs);
    timer.unref?.();
    try { one.ping((error) => { clearTimeout(timer); if (checking === one) checking = null; if (error && live(one)) dead(); }); }
    catch { clearTimeout(timer); dead(); }
  };
  const open = (url) => new Promise((resolve) => {
    const host = url.hostname, port = Number(url.port) || 443;
    const socket = tlsConnect({ host, port, ...(dial ? { socket: dial(host, port) } : {}), ...(isIP(host) ? {} : { servername: host }), ALPNProtocols: ["h2", "http/1.1"], ...(tlsSession ? { session: tlsSession } : {}), ...tlsOptions });
    socket.on("session", (value) => { tlsSession = value; });
    const failed = () => { socket.destroy(); resolve(null); };
    socket.once("error", failed);
    socket.setTimeout(H2_DIAL_MS, failed);
    socket.once("secureConnect", () => {
      socket.off("error", failed);
      socket.setTimeout(0);
      socket.setNoDelay(true);
      if (socket.alpnProtocol !== "h2") { h1Origins.add(url.origin); socket.destroy(); resolve(null); return; }
      const next = http2Connect(url.origin, { createConnection: () => socket, settings: { initialWindowSize: H2_STREAM_WINDOW } });
      next.on("error", () => {});
      next.on("goaway", () => { if (session === next) session = null; });
      next.on("close", () => { if (session === next) session = null; });
      next.once("connect", () => { next.setLocalWindowSize(H2_SESSION_WINDOW); resolve(next); });
    });
  });
  async function sessionFor(url) {
    if (live(session)) return session;
    opening ??= open(url).then((next) => { if (next) session = next; return next; }).finally(() => { opening = null; });
    return opening;
  }
  const request = (one, url, init) => new Promise((resolve, reject) => {
    const { signal } = init;
    const body = init.body == null ? null : Buffer.from(init.body);
    const headers = { ":method": init.method ?? "GET", ":path": `${url.pathname}${url.search}` };
    for (const [name, value] of Object.entries(init.headers ?? {})) headers[name.toLowerCase()] = value;
    if (body) headers["content-length"] = body.length;
    let stream;
    try { stream = one.request(headers, { endStream: !body }); } catch (error) { reject(error); return; }
    let answered = false;
    const quiet = setTimeout(() => { if (!answered) check(one); }, checkMs);
    quiet.unref?.();
    const stop = () => { stream.close(h2Constants.NGHTTP2_CANCEL); if (!answered) reject(signal.reason); };
    signal?.addEventListener("abort", stop, { once: true });
    const unanswered = (error) => {
      if (answered) return;
      answered = true;
      reject(stream.rstCode === h2Constants.NGHTTP2_REFUSED_STREAM ? Object.assign(new Error("the relay refused the stream"), { code: "ERR_HTTP2_REFUSED_STREAM" }) : error ?? new Error("the relay closed the stream"));
    };
    stream.once("error", unanswered);
    stream.once("close", () => { clearTimeout(quiet); signal?.removeEventListener("abort", stop); unanswered(null); });
    stream.once("response", (head) => {
      clearTimeout(quiet);
      if (answered) return;
      answered = true;
      const status = head[":status"];
      const out = new Headers();
      for (const [name, value] of Object.entries(head)) if (!name.startsWith(":")) for (const each of Array.isArray(value) ? value : [value]) out.append(name, String(each));
      const empty = status === 204 || status === 205 || status === 304 || init.method === "HEAD";
      if (empty) stream.resume();
      resolve(new Response(empty ? null : Readable.toWeb(stream), { status, headers: out }));
    });
    if (body) stream.end(body);
  });
  const go = async (input, init = {}) => {
    const url = new URL(input);
    if (init.signal?.aborted) throw init.signal.reason;
    if (url.protocol !== "https:" || h1Origins.has(url.origin)) return h1(input, init);
    lastUsed = Date.now();
    // a connection the relay is closing (goaway) or that died refuses a request unprocessed: once more on a fresh one
    for (let attempt = 0; ; attempt += 1) {
      const one = await until(sessionFor(url), init.signal);
      if (!one) return h1(input, init);
      init.onConnected?.();
      try { return await request(one, url, init); }
      catch (error) {
        if (attempt > 0 || init.signal?.aborted || !H2_UNSENT.has(error?.code)) throw error;
        if (session === one) { session = null; one.destroy(); }
      }
    }
  };
  go.connectAware = true;
  /** posts may share the connection with each other and the streamed read */
  go.multiplexed = () => live(session);
  go.postsInFlight = () => (live(session) ? H2_POSTS_IN_FLIGHT : POSTS_IN_FLIGHT);
  go.warm = (base) => {
    const stopH1 = h1.warm(base, () => h1Origins.has(new URL(base).origin) || !base.startsWith("https:"));
    // nginx closes an h2 connection idle for its keepalive timeout; the streamed read usually keeps it busy anyway
    const timer = setInterval(() => { if (live(session) && Date.now() - lastUsed >= WARM_MS - 5000) check(session); }, WARM_MS);
    timer.unref?.();
    return () => { stopH1(); clearInterval(timer); };
  };
  go.close = () => { session?.close(); session = null; h1.close(); };
  /** after a sleep or a network change: a fresh connection, resuming the tls session */
  go.reset = () => { session?.destroy(); session = null; h1.reset(); };
  return go;
}

/**
 * a relay read: one json document, or, from a relay that streams (`stream=1`), one {"frames":[...]} per line as frames
 * arrive, so a reply never waits for the next poll to reach the relay. true when the answer streamed.
 */
export async function readFrameBatches(response, onFrames) {
  if (!/^application\/x-ndjson\b/i.test(response.headers.get("content-type") ?? "")) {
    const { frames = [] } = await response.json();
    onFrames(frames);
    return false;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "", from = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    for (let at = text.indexOf("\n", from); at >= 0; at = text.indexOf("\n")) {
      const line = text.slice(0, at);
      text = text.slice(at + 1);
      if (line) onFrames(JSON.parse(line).frames ?? []);
    }
    from = text.length;
  }
  return true;
}

/** when to ask for a streamed read: always, except for a while after a proxy was seen holding the lines back */
export function streamChoice(now = Date.now) {
  let offUntil = 0;
  return { wanted: () => now() >= offUntil, stalled: () => { offUntil = now() + STREAM_OFF_MS; } };
}
// ---- end relay transport ----

/** what the app keeps to start a link: the secret goes in the command, the private key never leaves this computer */
export function newLinkKeys() {
  const secret = randomB32(26);
  const pair = x25519Pair();
  return { secret, ...pair, verifier: sha256hex(vpsTokenOf(secret)) };
}

/** the sealed result, opened and checked; throws on anything that is not exactly what a vps agent makes */
export function openResult({ id, priv, pub, vpsPub, sealed }) {
  const value = JSON.parse(open(sealKeyOf(priv, pub, vpsPub, id), id, sealed).toString("utf8"));
  const ok = value && value.v === 1 && (value.mode === "relay" || value.mode === "direct")
    && typeof value.pairing?.code === "string" && /^[A-Z0-9-]{4,40}$/.test(value.pairing.code)
    && typeof value.tunnel?.key === "string" && typeof value.tunnel?.token === "string" && value.tunnel.id === id
    && (value.mode === "relay" || (typeof value.origin === "string" && /^https:\/\/[a-z0-9.-]+$/.test(value.origin) && typeof value.spki === "string"));
  if (!ok) throw new Error("The server's answer was not one this app understands. Update OpenMausBot and try again.");
  return { ...value, name: typeof value.name === "string" && value.name.trim() ? value.name.trim().slice(0, 60) : "My server" };
}

export function createRelayClient({ base, fetch: fetchImpl = fetch }) {
  async function call(method, route, token, body, signal) {
    const response = await fetchImpl(`${base}${route}`, {
      method,
      headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ?? AbortSignal.timeout(40_000),
    });
    const parsed = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(typeof parsed?.error === "string" ? parsed.error : `The link service answered ${response.status}.`), { status: response.status, code: parsed?.code });
    return parsed;
  }
  return {
    base,
    create: (body, signal) => call("POST", "/v1/sessions", null, body, signal),
    watch: (id, watch, after, signal) => call("GET", `/v1/sessions/${id}/events?after=${after}&wait=25`, watch, undefined, signal ?? AbortSignal.timeout(40_000)),
    cancel: (id, watch) => call("DELETE", `/v1/sessions/${id}`, watch),
    forget: (id, token) => call("DELETE", `/v1/tunnels/${id}`, token),
    status: (id, token) => call("GET", `/v1/tunnels/${id}/status`, token),
  };
}

/** a relay stream still open this long after the direct path came up moves over (an event stream reconnects by itself) */
const MOVE_AFTER_MS = 3000;
/**
 * a websocket (the live desktop) opened while the direct path is dialling waits this long for it before taking the relay;
 * once a dial failed on this network it waits for nothing
 */
export const UPGRADE_HOLD_MS = 700;

/** the relay's tcp socket, with what this computer sends kept under a lossy vpn's real mtu once it connects */
function clampedDial(host, port) {
  const socket = netConnect({ host, port });
  socket.once("connect", () => void clampMss(socket));
  return socket;
}

/**
 * the app's end of the tunnel: a loopback http server at http://vps-<id>.localhost:<port> whose requests travel to the
 * vps sealed, and whose replies stream back the same way. only that host name is served. two paths carry the frames:
 * the relay, always there, and the direct path (vps-link-direct.mjs) once `useDirect` gave it a way to connect. each
 * request takes the best path when it starts and keeps it; a lost direct path sends a request that had no answer yet
 * and can safely be sent again over the relay, and fails the rest.
 * `egress`: makes this app's end of "route traffic through this computer" (vps-link-egress.mjs createEgressEndpoint) from
 * the tunnel's stream api; without it the vps's stream requests go unanswered. on the relay it has a queue and posts of
 * its own; while the direct path is up the agent dials over that instead, in the direct writer's lane.
 */
export function createTunnelProxy({ base, id, route = `${base}/v1/tunnels/${id}`, key: keyText, token, port = 0, fetch: given, log = () => {}, replyTimeoutMs = 90_000, stallMs = STREAM_STALL_MS, direct: directSpec = null, directFactory = createDirectLink, egress: makeEgress = null, waitS = 25, aheadMs = STREAM_AHEAD_MS, hello = {} }) {
  const fetchImpl = given ?? relayFetch({ dial: clampedDial });
  const stream = streamChoice();
  let unwarm = () => {};
  const key = Buffer.from(keyText, "base64url");
  const guard = frameGuard();
  const host = `vps-${id}.localhost`;
  const waiting = new Map();
  let server = null, server6 = null, polling = false, closed = false, listeningPort = port;
  let successfulPosts = 0, pollRetry = null, pollNudge = null;
  const abort = new AbortController();

  const epoch = randomB32(12);
  let ordered = false;
  // the egress lane's posts carry no sequence: they never wait in the relay behind the main queue's held posts
  async function post(frames, at, lane = false) {
    for (let attempt = 0; !closed; attempt += 1) {
      try {
        const response = await fetchImpl(`${route}/to-vps`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(lane ? { frames, lane: true } : { frames, epoch, seq: at }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]) });
        // read, not cancelled: a cancelled body closes the socket the next post would reuse
        const said = await response.text().catch(() => "");
        if (response.ok && !ordered && !lane) ordered = /"ordered":true/.test(said);
        if (response.ok) { successfulPosts += 1; pollRetry?.abort(); return true; }
        if (response.status === 404) { closed = true; abort.abort(); fail("This server was unlinked."); return false; }
      } catch { if (closed) return false; }
      if (attempt >= 6) { if (!lane) fail("The link service did not answer."); return false; }
      await sleep(Math.min(5000, 200 * 2 ** attempt), undefined, { signal: abort.signal }).catch(() => {});
    }
    return false;
  }
  const outbox = createOutbox({ seal: (r, bytes) => sealBytes(key, id, "to-vps", r, bytes), post, delayMs: () => (fetchImpl.multiplexed?.() ? 0 : H1_POST_DELAY_MS), signal: abort.signal, parallel: () => (ordered ? fetchImpl.postsInFlight?.() ?? POSTS_IN_FLIGHT : 1), onError: () => fail("The link service did not answer.") });
  const relayPath = {
    push: (frame) => { if (frame.t === "cancel") outbox.discard(frame.r); outbox.push(sealFrame(key, id, "to-vps", frame), frame.r); },
    bytes: outbox.bytes, onDrain: outbox.onDrain, discard: outbox.discard,
  };
  let direct = null, moveTimer = null;
  // a stream keeps its path while that connection lasts (a suspect one included); only new requests avoid it
  const pathOf = (r) => (waiting.get(r)?.via === "direct" && direct?.state() === "up" ? direct : relayPath);
  const emit = (frame) => {
    const path = pathOf(frame.r);
    if (frame.t === "cancel") path.discard(frame.r);
    path.push(frame);
  };
  const sendBytes = (r, chunk) => pathOf(r).bytes(r, chunk);
  const onDrain = (r, resume) => pathOf(r).onDrain(resume);
  /** the path a new request takes */
  const pick = () => (direct?.ready() ? "direct" : "relay");
  function fail(message) {
    for (const entry of waiting.values()) entry.fail(message);
    waiting.clear();
  }
  const lane = createOutbox({ seal: (r, bytes) => sealBytes(key, id, "to-vps", r, bytes), post: (frames, at) => post(frames, at, true), delayMs: 0, signal: abort.signal, onError: () => log("vps link: an egress post failed") });
  const egressDirect = {
    live: () => Boolean(direct?.ready()),
    send: (frame) => direct?.push(frame),
    bytes: (r, chunk) => (direct ? direct.bytes(r, chunk, true) : true),
    queued: () => direct?.queued?.() ?? 0,
    onDrain: (resume) => (direct ? direct.onDrain(resume) : resume()),
  };
  const egress = makeEgress?.({
    send: (frame) => { if (frame.t === "cancel") lane.discard(frame.r); lane.push(sealFrame(key, id, "to-vps", frame), frame.r); },
    bytes: (r, chunk) => lane.bytes(r, chunk), queued: () => lane.size, onDrain: (resume) => lane.onDrain(resume), direct: egressDirect, log,
  }) ?? null;

  function directChanged({ state, lost }) {
    if (lost) egress?.pathLost?.("direct");
    if (lost) {
      // what was on the direct path: sent again over the relay when that is safe, failed otherwise
      for (const [r, entry] of [...waiting]) {
        if (entry.via !== "direct") continue;
        if (entry.replay?.()) { entry.via = "relay"; log("vps link: a request moved to the relay"); continue; }
        waiting.delete(r);
        entry.fail("The connection to your server changed. Try again.");
      }
    }
    clearTimeout(moveTimer);
    if (state === "up" && direct?.ready()) {
      moveTimer = setTimeout(() => {
        if (!direct?.ready()) return;
        for (const [r, entry] of [...waiting]) if (entry.via === "relay" && entry.movable?.()) { waiting.delete(r); relayPath.push({ t: "cancel", r }); entry.move(); }
      }, MOVE_AFTER_MS);
      moveTimer.unref?.();
    }
  }
  function useDirect(spec) {
    direct?.close();
    direct = null;
    if (!spec || closed) return;
    direct = directFactory({ id, key: keyText, guard, connect: spec.connect, onFrame: (frame) => deliver(frame, "direct"), onChange: directChanged, onFailure: spec.onFailure ?? (() => {}), log, hello });
    direct.start();
  }

  function deliver(frame, via = "relay") {
    if (egress?.handle(frame, via)) return;
    const entry = waiting.get(frame.r);
    if (!entry) return;
    entry.touch();
    if (frame.t === "head") entry.head(frame.status, frame.headers ?? {});
    else if (frame.t === "data") entry.data(Buffer.from(frame.d ?? "", "base64"));
    else if (frame.t === "bytes") entry.data(frame.b);
    else if (frame.t === "end") { waiting.delete(frame.r); entry.end(); }
    else if (frame.t === "err") { waiting.delete(frame.r); entry.fail(frame.message ?? "The server did not answer."); }
    else if (frame.t === "ctl") { waiting.delete(frame.r); entry.ctl(frame); }
  }

  async function poll() {
    if (polling) return;
    polling = true;
    let failures = 0, ahead = null;
    while (!closed) {
      const postsBefore = successfulPosts;
      const next = ahead;
      ahead = null;
      const streaming = next !== null || stream.wanted();
      const stall = new AbortController();
      let heard = false;
      let stallTimer = null, aheadTimer = null;
      const armStall = () => { if (streaming && !stallTimer) stallTimer = setTimeout(() => { if (!heard) stall.abort(); }, stallMs); };
      if (!next && !fetchImpl.connectAware) armStall();
      // a nudge ends the read in hand and the one asked for ahead of it
      const nudged = (pollNudge = next?.nudge ?? new AbortController());
      const read = (signal, onConnected) => fetchImpl(`${route}/to-app?wait=${waitS}${streaming ? "&stream=1" : ""}`, { headers: { authorization: `Bearer ${token}` }, signal, onConnected });
      try {
        const response = await (next?.response ?? read(AbortSignal.any([abort.signal, stall.signal, nudged.signal, AbortSignal.timeout(40_000)]), armStall));
        if (streaming) {
          aheadTimer = setTimeout(() => {
            const own = new AbortController();
            ahead = { nudge: own, response: read(AbortSignal.any([abort.signal, nudged.signal, own.signal, AbortSignal.timeout(aheadMs + 40_000)])) };
            ahead.response.catch(() => {});
          }, aheadMs);
        }
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 404) { closed = true; abort.abort(); fail("This server was unlinked."); break; }
          throw new Error(`link service answered ${response.status}`);
        }
        await readFrameBatches(response, (frames) => {
          heard = true;
          failures = 0;
          for (const sealed of frames) {
            let frame = null;
            try { frame = openFrame(key, id, "to-app", sealed, guard); } catch { log("vps link: dropped a frame that did not open"); }
            if (frame) deliver(frame);
          }
        });
      } catch (error) {
        if (closed) break;
        if (nudged.signal.aborted) { ahead = null; continue; }
        if (stall.signal.aborted && !heard) {
          stream.stalled();
          log("vps link: the link service's streamed replies were held back; polling instead");
          continue;
        }
        failures += 1;
        if (failures === 1 || failures % 20 === 0) log(`vps link: tunnel retrying (${error?.message ?? error})`);
        if (postsBefore === successfulPosts) {
          pollRetry = new AbortController();
          await sleep(Math.min(15_000, 300 * 2 ** Math.min(failures, 6)), undefined, { signal: AbortSignal.any([abort.signal, pollRetry.signal]) }).catch(() => {});
          pollRetry = null;
        }
      } finally { clearTimeout(stallTimer); clearTimeout(aheadTimer); }
    }
    polling = false;
  }

  function onRequest(req, res) {
    const hostHeader = String(req.headers.host ?? "");
    if (hostHeader !== `${host}:${listeningPort}`) { res.writeHead(421, { "content-type": "text/plain" }); res.end("wrong host"); return; }
    if (closed) { res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "This server is not connected." })); return; }
    const r = randomB32(12);
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) if (!HOP.has(name)) headers[name] = value;
    let timer = null, eventStream = false;
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => { emit({ t: "cancel", r }); waiting.delete(r); answer(504, "The server took too long to answer."); }, replyTimeoutMs); };
    const answer = (status, message) => {
      clearTimeout(timer);
      if (!res.headersSent) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify({ error: message })); }
      else res.destroy();
    };
    const bodyless = req.method === "GET" || req.method === "HEAD" || req.headers["content-length"] === "0";
    const request = { t: "req", r, method: req.method, path: req.url, headers, end: bodyless };
    const idempotent = bodyless && (req.method === "GET" || req.method === "HEAD");
    waiting.set(r, {
      via: pick(),
      touch,
      head: (status, out) => {
        eventStream = /^text\/event-stream\b/i.test(String(out["content-type"] ?? ""));
        res.writeHead(status, out);
        res.flushHeaders?.();
      },
      data: (chunk) => {
        if (res.writableLength + chunk.length > RECEIVE_HIGH) {
          emit({ t: "cancel", r });
          waiting.delete(r);
          answer(502, "The response exceeded this connection's buffer limit.");
          return;
        }
        res.write(chunk);
      },
      end: () => { clearTimeout(timer); res.end(); },
      fail: (message) => answer(502, message),
      ctl: () => {},
      // nothing came back yet and asking again changes nothing: the same request goes out over the relay
      replay: () => { if (!idempotent || res.headersSent) return false; relayPath.push(request); return true; },
      // an event stream reconnects when it ends, and then takes the direct path
      movable: () => eventStream,
      move: () => { clearTimeout(timer); res.end(); },
    });
    touch();
    res.on("close", () => { clearTimeout(timer); if (waiting.has(r)) { emit({ t: "cancel", r }); waiting.delete(r); } });
    emit(request);
    if (bodyless) return;
    req.on("data", (chunk) => { if (waiting.has(r) && !sendBytes(r, chunk)) { req.pause(); onDrain(r, () => req.resume()); } });
    req.on("end", () => { if (waiting.has(r)) emit({ t: "body", r, end: true }); });
  }

  /** a websocket (the live desktop): the handshake travels like a request, then its bytes both ways, raw and sealed */
  function onUpgrade(req, socket, head) {
    socket.on("error", () => socket.destroy());
    if (String(req.headers.host ?? "") !== `${host}:${listeningPort}`) { socket.end("HTTP/1.1 421 Misdirected Request\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"); return; }
    if (closed) { socket.end("HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"); return; }
    socket.setNoDelay(true);
    // the live desktop is long-lived and moving it means a reconnect: worth a short wait for the direct path
    const dialling = direct && !direct.ready() && !direct.failing?.() && ["connecting", "up"].includes(direct.state());
    if (!dialling) { upgradeVia(req, socket, head, pick()); return; }
    socket.pause();
    void direct.whenUp(UPGRADE_HOLD_MS).then(() => { if (!socket.destroyed && !closed) upgradeVia(req, socket, head, pick()); else socket.destroy(); });
  }

  function upgradeVia(req, socket, head, via) {
    const r = randomB32(12);
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) if (!HOP.has(name)) headers[name] = value;
    let timer = null, answered = false, open = false;
    const refuse = (status, message) => {
      clearTimeout(timer);
      if (answered) { socket.destroy(); return; }
      answered = true;
      const body = JSON.stringify({ error: message });
      socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\ncontent-type: application/json; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
    };
    // only the handshake has a deadline: an idle desktop may say nothing for a long while
    const touch = () => { if (open) return; clearTimeout(timer); timer = setTimeout(() => { if (waiting.has(r)) { emit({ t: "cancel", r }); waiting.delete(r); } refuse(504, "The server took too long to answer."); }, replyTimeoutMs); };
    const read = (chunk) => { if (waiting.has(r) && !sendBytes(r, chunk)) { socket.pause(); onDrain(r, () => socket.resume()); } };
    waiting.set(r, {
      via,
      touch,
      head: (status, out) => {
        answered = true;
        open = status === 101;
        if (open) clearTimeout(timer);
        const lines = [`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ""}`, ...(open ? ["Upgrade: websocket", "Connection: Upgrade"] : ["Connection: close"])];
        for (const [name, value] of Object.entries(out)) {
          for (const one of Array.isArray(value) ? value : [value]) if (/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) && !/[\r\n]/.test(String(one))) lines.push(`${name}: ${one}`);
        }
        socket.write(`${lines.join("\r\n")}\r\n\r\n`);
        // a socket held for the direct path was paused, and what it buffered meanwhile is read only from here on
        if (open) { socket.on("data", read); socket.resume(); }
      },
      data: (chunk) => {
        if (socket.writableLength + chunk.length > RECEIVE_HIGH) {
          emit({ t: "cancel", r });
          waiting.delete(r);
          refuse(502, "The desktop exceeded this connection's buffer limit.");
          return;
        }
        socket.write(chunk);
      },
      end: () => { clearTimeout(timer); socket.end(); },
      fail: (message) => refuse(502, message),
      ctl: () => {},
    });
    touch();
    socket.on("close", () => { clearTimeout(timer); if (waiting.has(r)) { emit({ t: "cancel", r }); waiting.delete(r); } });
    emit({ t: "req", r, method: req.method, path: req.url, headers, end: true, up: true });
    if (head?.length) sendBytes(r, head);
  }

  return {
    host,
    origin: () => `http://${host}:${listeningPort}`,
    async start() {
      if (closed) throw new Error("This server is not connected.");
      if (server) return `http://${host}:${listeningPort}`;
      server = createServer(onRequest);
      server.on("upgrade", onUpgrade);
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => resolve()); });
      listeningPort = server.address().port;
      // *.localhost resolves to ::1 first for node's fetch, so the same port answers on ipv6 loopback too
      const v6 = createServer(onRequest);
      v6.on("upgrade", onUpgrade);
      await new Promise((resolve) => { v6.once("error", () => resolve()); v6.listen(listeningPort, "::1", () => { server6 = v6; resolve(); }); });
      if (!given) unwarm = fetchImpl.warm(base);
      void poll();
      if (directSpec) useDirect(directSpec);
      egress?.start();
      return `http://${host}:${listeningPort}`;
    },
    /** gives the direct path a way to connect (null: relay only); it dials in the background */
    useDirect,
    /** the path a request started now would take */
    transport: () => (direct?.ready() ? "direct" : "relay"),
    /** what the agent said in its last direct hello, or null */
    agentHello: () => direct?.peer?.() ?? null,
    /** how the direct path is connected while it is up: "ssh" or "wss" */
    directVia: () => (direct?.ready() ? direct.via?.() ?? "ssh" : null),
    /** after a sleep or a network change: the relay reconnects at once on fresh sockets, the direct path proves itself */
    nudge() {
      if (closed) return;
      fetchImpl.reset?.();
      pollNudge?.abort();
      direct?.nudge();
    },
    /** a request for the agent itself (credentials, pausing the server), answered over the same sealed tunnel */
    control(op, data, timeoutMs = 30_000) {
      if (closed) return Promise.reject(new Error("This server is not connected."));
      void poll();
      const r = randomB32(12);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(r); reject(new Error("Your server did not answer. Is it on?")); }, timeoutMs);
        const frame = { t: "ctl", r, op, data };
        waiting.set(r, { via: pick(), touch: () => {}, head: () => {}, data: () => {}, end: () => {}, fail: (message) => { clearTimeout(timer); reject(new Error(message)); },
          ctl: (answer) => { clearTimeout(timer); if (answer.ok) resolve(answer.data ?? { ok: true }); else reject(new Error(answer.error ?? "Your server said no.")); },
          replay: () => { relayPath.push(frame); return true; } });
        emit(frame);
      });
    },
    async close() {
      // the goodbye gets a moment to leave, so the vps stops routing through this computer at once
      if (egress && !closed) { egress.close(); await sleep(300); }
      closed = true;
      clearTimeout(moveTimer);
      direct?.close();
      direct = null;
      abort.abort();
      unwarm();
      if (!given) fetchImpl.close();
      fail("closed");
      if (server) await new Promise((resolve) => server.close(() => resolve()));
      if (server6) await new Promise((resolve) => server6.close(() => resolve()));
      server = null;
      server6 = null;
    },
  };
}
