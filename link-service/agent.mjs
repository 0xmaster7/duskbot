// the openmausbot link agent on a person's vps. the install script runs it as:
//   node agent.mjs probe    (root)  can the link service reach this server directly on port 80? exit 0 yes, 3 no
//   node agent.mjs link     (maus)  mint a pairing code, seal it for the app, report the result, write tunnel.json
//   node agent.mjs tunnel   (maus)  the steady-state relay: requests from the app, sealed end to end, to 127.0.0.1:8799
//   node agent.mjs direct   (maus)  the same frames on stdin/stdout: what the app's own ssh key may run, and nothing else
// standalone on purpose: node's own modules only, one file the link service serves at /agent.mjs.
// it also lends the bot computers on this server the app's own internet connection when the person turns on "route
// traffic through this computer": a socks5 and http connect proxy on the bot computers' bridge (see createEgressProxy).
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { BlockList, createServer as createTcpServer } from "node:net";
import { Agent as HttpAgent, createServer, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { Socket } from "node:net";
import { Readable } from "node:stream";
import { connect as tlsConnect } from "node:tls";
import { homedir, hostname, networkInterfaces, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const SERVER = { host: "127.0.0.1", port: Number(process.env.LINK_SERVER_PORT) || 8799 };
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
  // 0: frames pushed in the same turn share a post and nothing waits longer (a timer would add a millisecond or more)
  const settle = () => (delayMs > 0 ? delay(delayMs, undefined, { signal }) : new Promise((resolve) => setImmediate(resolve)));
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
        await settle();
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
            if (nudged) await settle();
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
/** hop-by-hop headers never cross the tunnel */
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "content-length", "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "forwarded"]);

// ---- crypto shared with electron/vps-link-protocol.mjs (keep both in step; a test checks they interoperate) ----
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
/** `sealed` is base64url (relay) or bytes (direct); the guard keys on the iv either way, so one guard spans both paths */
export function openFrame(key, id, dir, sealed, guard) {
  const plain = open(key, `${id}|${dir}`, sealed);
  const value = plain[0] === 1 && plain.length >= 21
    ? { t: "bytes", r: plain.toString("latin1", 1, 13), ts: plain.readDoubleBE(13), b: plain.subarray(21) }
    : JSON.parse(plain.toString("utf8"));
  if (guard && !guard(typeof sealed === "string" ? sealed.slice(0, 16) : sealed.subarray(0, 12).toString("base64url"), value.ts)) return null;
  return value;
}
// ---- end shared crypto ----

// ---- relay transport shared with electron/vps-link-protocol.mjs ----
/** how long a streamed read may stay silent before this end decides a proxy holds the lines back and polls instead */
export const STREAM_STALL_MS = 5000;
const STREAM_OFF_MS = 10 * 60_000;
const WARM_MS = 40_000;

/**
 * fetch over node's own http(s) with its sockets kept open. the global fetch closes an idle socket after 4 s (undici's
 * default), so every reply after a pause paid a new tcp and tls handshake to the link service, and a cold tcp window.
 */
export function keepAliveFetch({ maxSockets = 8 } = {}) {
  const agents = new Map();
  let lastUsed = 0;
  const agentFor = (protocol) => {
    let found = agents.get(protocol);
    if (!found) agents.set(protocol, (found = new (protocol === "https:" ? HttpsAgent : HttpAgent)({ keepAlive: true, keepAliveMsecs: 15_000, maxSockets, scheduling: "lifo" })));
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
  go.warm = (base) => {
    const timer = setInterval(() => {
      if (Date.now() - lastUsed < WARM_MS - 5000) return;
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

// ---- direct transport shared with electron/vps-link-direct.mjs (keep both in step; a test checks they interoperate) ----
/** each end writes this first; a login shell's greeting before it is skipped */
export const DIRECT_MAGIC = Buffer.from("\0OMBD1\n", "latin1");
export const REC_SEALED = 1;
export const REC_ACK = 2;
/** a stream's bytes go out in pieces this size, taking turns with the other streams */
const DIRECT_PIECE = 16 * 1024;
/**
 * stream bytes sent and not yet acknowledged: what the path delivers in its round trip plus DIRECT_QUEUE_MS, measured
 * from the acks, so a transfer fills the path and an api frame still waits at most about that long behind it
 */
export const DIRECT_INFLIGHT = 384 * 1024;
const DIRECT_INFLIGHT_MIN = 384 * 1024;
const DIRECT_INFLIGHT_MAX = 8 * 1024 * 1024;
const DIRECT_QUEUE_MS = 250;
const DIRECT_ACK_EVERY = 32 * 1024;
const DIRECT_MAX_RECORD = 1024 * 1024;
const DIRECT_HIGH = 2 * 1024 * 1024;
const DIRECT_LOW = 512 * 1024;

export function directRecord(type, payload) {
  const head = Buffer.allocUnsafe(5);
  head.writeUInt32BE(payload.length + 1, 0);
  head[4] = type;
  return Buffer.concat([head, payload]);
}

/** records out of a byte stream: [u32 length][type][payload]. throws on anything malformed */
export function directReader(onRecord) {
  let buf = Buffer.alloc(0), synced = false;
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    if (!synced) {
      const at = buf.indexOf(DIRECT_MAGIC);
      if (at < 0) {
        if (buf.length > 64 * 1024) throw new Error("no direct link here");
        return;
      }
      buf = buf.subarray(at + DIRECT_MAGIC.length);
      synced = true;
    }
    while (buf.length >= 5) {
      const length = buf.readUInt32BE(0);
      if (length < 1 || length > DIRECT_MAX_RECORD) throw new Error("malformed record");
      if (buf.length < 4 + length) break;
      const type = buf[4], payload = buf.subarray(5, 4 + length);
      buf = buf.subarray(4 + length);
      onRecord(type, payload);
    }
  };
}

/**
 * the sending half of a direct link. a frame for a stream with bytes still queued waits behind them (its order is kept);
 * every other frame goes first. queued bytes take turns, a piece per stream, with at most DIRECT_INFLIGHT unacknowledged,
 * so a busy desktop or a download never holds an api call back for long.
 */
export function createDirectWriter({ sealFrame: sealOne, sealBytes: sealPiece, write, inflight: fixed = null, now = () => performance.now() }) {
  const urgent = [];
  // the path, from the acks: the smallest round trip lately and the best delivery rate lately
  const sent = [];
  let sentTotal = 0, ackedTotal = 0, minRtt = null, minAt = 0, rateFrom = null, rates = [];
  let inflight = fixed ?? DIRECT_INFLIGHT;
  function learn(count) {
    const t = now();
    ackedTotal += count;
    let at = null;
    while (sent.length && sent[0].end <= ackedTotal) at = sent.shift().at;
    if (at !== null) {
      const sample = t - at;
      if (minRtt === null || sample <= minRtt || t - minAt > 10_000) { minRtt = sample; minAt = t; }
    }
    if (rateFrom === null) rateFrom = { t, bytes: ackedTotal - count };
    // acks arrive in bunches: rates over a couple of round trips, averaged, and the window grows by half at most per step
    if (minRtt !== null && t - rateFrom.t >= Math.max(2 * minRtt, 300)) {
      rates = [...rates.slice(-3), ((ackedTotal - rateFrom.bytes) * 1000) / (t - rateFrom.t)];
      rateFrom = { t, bytes: ackedTotal };
      const rate = rates.reduce((sum, one) => sum + one, 0) / rates.length;
      if (fixed === null) inflight = Math.min(DIRECT_INFLIGHT_MAX, inflight * 1.5, Math.max(DIRECT_INFLIGHT_MIN, (rate * (minRtt + DIRECT_QUEUE_MS)) / 1000));
    }
  }
  const streams = new Map();
  const drains = new Set();
  let queued = 0, unacked = 0, received = 0, blocked = false, closed = false, scheduled = false;
  const release = () => { const waiting = [...drains]; drains.clear(); for (const resume of waiting) resume(); };
  function next() {
    if (urgent.length) return urgent.shift();
    for (const [r, items] of streams) {
      const item = items[0];
      if (item.record) { items.shift(); }
      else {
        if (unacked >= inflight) continue;
        let need = Math.min(DIRECT_PIECE, item.size);
        const pieces = [];
        while (need > 0) {
          const part = item.parts[0];
          if (part.length <= need) { pieces.push(part); item.parts.shift(); need -= part.length; }
          else { pieces.push(part.subarray(0, need)); item.parts[0] = part.subarray(need); need = 0; }
        }
        const piece = pieces.length === 1 ? pieces[0] : Buffer.concat(pieces);
        item.size -= piece.length;
        queued -= piece.length;
        unacked += piece.length;
        sentTotal += piece.length;
        sent.push({ end: sentTotal, at: now() });
        if (sent.length > 4096) sent.shift();
        if (!item.size) items.shift();
        streams.delete(r);
        if (items.length) streams.set(r, items);
        return directRecord(REC_SEALED, sealPiece(r, piece));
      }
      // a frame that waited behind its stream's bytes; the stream goes to the back of the line
      streams.delete(r);
      if (items.length) streams.set(r, items);
      return item.record;
    }
    return null;
  }
  /**
   * what is ready goes out as one write, a turn after the first of it: sshd does not set nodelay for a session without a
   * pty, so a reply's head, bytes and end written apart would each wait for an ack (a round trip, or a delayed ack)
   */
  function pump() {
    scheduled = false;
    const out = [];
    let size = 0;
    while (!blocked && !closed) {
      const record = next();
      if (!record) break;
      out.push(record);
      size += record.length;
      if (size >= 256 * 1024) { if (write(out.length === 1 ? out[0] : Buffer.concat(out)) === false) blocked = true; out.length = 0; size = 0; }
    }
    if (out.length && !closed && write(out.length === 1 ? out[0] : Buffer.concat(out)) === false) blocked = true;
    if (drains.size && queued < DIRECT_LOW) release();
  }
  const kick = () => { if (!scheduled && !closed) { scheduled = true; setImmediate(pump); } };
  return {
    push(frame) {
      if (closed) return;
      const record = directRecord(REC_SEALED, sealOne(frame));
      const items = frame.r ? streams.get(frame.r) : undefined;
      if (items) items.push({ record }); else urgent.push(record);
      kick();
    },
    /** false: stop reading this stream until `onDrain` calls back */
    bytes(r, chunk) {
      if (closed) return true;
      let items = streams.get(r);
      if (!items) streams.set(r, (items = []));
      const last = items[items.length - 1];
      if (last && !last.record) { last.parts.push(chunk); last.size += chunk.length; }
      else items.push({ parts: [chunk], size: chunk.length });
      queued += chunk.length;
      kick();
      return queued < DIRECT_HIGH;
    },
    onDrain(resume) { if (closed || queued < DIRECT_LOW) resume(); else drains.add(resume); },
    discard(r) {
      const items = streams.get(r);
      if (!items) return;
      for (const item of items) if (!item.record) queued -= item.size;
      streams.delete(r);
      if (queued < DIRECT_LOW) release();
    },
    /** the other end got this many stream bytes */
    acked(count) { unacked = Math.max(0, unacked - count); learn(count); kick(); },
    /** stream bytes that arrived here: acknowledged every so often, ahead of everything else */
    received(count) {
      received += count;
      if (received < DIRECT_ACK_EVERY || closed) return;
      const payload = Buffer.alloc(4);
      payload.writeUInt32BE(received, 0);
      received = 0;
      urgent.unshift(directRecord(REC_ACK, payload));
      kick();
    },
    drained() { blocked = false; kick(); },
    close() { closed = true; urgent.length = 0; streams.clear(); queued = 0; release(); },
    get size() { return queued; },
    get unacked() { return unacked; },
    get inflight() { return inflight; },
  };
}
// ---- end direct transport ----

const configDir = () => join(homedir(), ".config", "openmausbot-link");
const tunnelFile = () => join(configDir(), "tunnel.json");
const enginesFile = () => join(homedir(), ".config", "openmausbot", "engines.env");
const codexAuthFile = () => join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json");

function writePrivate(path, text) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function relay(base, route, token, init = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(`${base}${route}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
        signal: init.signal ?? AbortSignal.timeout(40_000),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status >= 500 && attempt < 3) throw new Error(`link service answered ${response.status}`);
      return { status: response.status, body };
    } catch (error) {
      if (init.signal?.aborted || attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}

function local(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = httpRequest({ ...SERVER, method, path, headers: { accept: "application/json", "x-openmausbot-cli": "1", ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}) }, timeout: 15_000 }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* not json */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on("timeout", () => req.destroy(new Error("OpenMausBot on this server did not answer")));
    req.on("error", reject);
    req.end(payload ?? undefined);
  });
}

/** the leaf certificate's public key as the app pins it: sha256 of the spki der, base64 */
export function spkiOf(host, port = 443) {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({ host, port, servername: host, rejectUnauthorized: true, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert?.pubkey) return reject(new Error("no certificate"));
      resolve(createHash("sha256").update(cert.pubkey).digest("base64"));
    });
    socket.on("timeout", () => socket.destroy(new Error("timed out")));
    socket.on("error", reject);
  });
}

async function probe() {
  const base = env("LINK_BASE"), id = env("LINK_ID"), token = env("LINK_TOKEN");
  const nonce = randomBytes(16).toString("hex");
  let server = null;
  try {
    server = await new Promise((resolve, reject) => {
      const listening = createServer((req, res) => {
        if (req.url === `/.well-known/omb-link/${nonce}`) { res.writeHead(200, { "content-type": "text/plain" }); res.end(nonce); }
        else { res.writeHead(404); res.end(); }
      });
      listening.once("error", reject);
      listening.listen(80, "0.0.0.0", () => resolve(listening));
    });
  } catch (error) {
    console.error(`port 80 is busy here (${error.code ?? error.message}), so the app will reach this server through the link service`);
  }
  const answer = await relay(base, `/v1/sessions/${id}/probe`, token, { method: "POST", body: JSON.stringify({ nonce }) });
  server?.close();
  if (answer.body?.ip) console.log(`ip=${answer.body.ip}`);
  return server && answer.status === 200 && answer.body?.reachable === true ? 0 : 3;
}

async function link() {
  const base = env("LINK_BASE"), id = env("LINK_ID"), token = env("LINK_TOKEN");
  const mode = process.env.LINK_MODE === "direct" ? "direct" : "relay";
  const name = (process.env.LINK_NAME || hostname()).slice(0, 60);
  let saved = null;
  try { saved = JSON.parse(readFileSync(tunnelFile(), "utf8")); } catch { /* not linked yet */ }
  const claimed = await relay(base, `/v1/sessions/${id}/claim`, token, { method: "POST", body: JSON.stringify({}) });
  if (claimed.status === 410 && saved?.id) return 4;
  if (claimed.status !== 200) throw new Error(claimed.body?.error ?? `the link service answered ${claimed.status}`);
  const appPub = claimed.body.appPub;
  const [pairing, environment] = await Promise.all([
    local("POST", "/api/auth/pairing", { label: claimed.body.label || "OpenMausBot app" }),
    local("GET", "/.well-known/openmausbot/environment"),
  ]);
  if (pairing.status !== 200 || typeof pairing.body?.code !== "string") throw new Error(`OpenMausBot here would not make a pairing code (${pairing.status})`);
  const origin = mode === "direct" ? `https://${env("LINK_HOST")}` : null;
  const spki = mode === "direct" ? await spkiOf(env("LINK_HOST")) : null;
  const tunnel = { key: randomBytes(32).toString("base64url"), vps: randomBytes(32).toString("base64url"), app: randomBytes(32).toString("base64url") };
  const mine = x25519Pair();
  const payload = {
    v: 1, mode, origin, spki, name,
    environmentId: typeof environment.body?.environmentId === "string" ? environment.body.environmentId : null,
    // the server's long-term identity, which signs each key the app seals secrets for: the app pins it from here
    sealIdentity: typeof environment.body?.sealIdentity === "string" ? environment.body.sealIdentity : null,
    pairing: { code: pairing.body.code, expiresAt: pairing.body.expiresAt ?? null },
    tunnel: { id, key: tunnel.key, token: tunnel.app },
  };
  const sealed = seal(sealKeyOf(mine.priv, mine.pub, appPub, id), id, Buffer.from(JSON.stringify(payload)));
  writePrivate(tunnelFile(), JSON.stringify({ v: 1, base, id, key: tunnel.key, token: tunnel.vps, mode, origin }));
  const result = await relay(base, `/v1/sessions/${id}/result`, token, {
    method: "POST", body: JSON.stringify({ sealed, vpsPub: mine.pub, tunnel: { vps: sha256hex(tunnel.vps), app: sha256hex(tunnel.app) } }),
  });
  if (result.status !== 200) throw new Error(result.body?.error ?? `the link service answered ${result.status}`);
  return 0;
}

// ---- tunnel ----

function setEnvLine(text, key, value) {
  const lines = text.split("\n").filter((line) => line && !line.startsWith(`${key}=`));
  if (value !== null) lines.push(`${key}=${value}`);
  return `${lines.join("\n")}\n`;
}

/** what the app may ask of this agent directly, never of the server: credentials it signed in for on the mac */
// ---- the direct link: the app's own ssh key, which may only start `agent.mjs direct` ----
const authorizedKeysFile = () => join(homedir(), ".ssh", "authorized_keys");
const directTag = (id) => `omb-link-${id}`;
const SAFE_PATH = /^\/[\w./+-]+$/;

/** the authorized_keys line for the app's key: restrict (no shell, pty, agent or port forwarding) and one forced command */
export function directKeyLine({ pub, id, node = process.execPath, agent = fileURLToPath(import.meta.url) }) {
  const match = /^ssh-ed25519 ([A-Za-z0-9+/]{68})$/.exec(typeof pub === "string" ? pub.trim() : "");
  const blob = match ? Buffer.from(match[1], "base64") : null;
  if (!blob || blob.length !== 51 || blob.readUInt32BE(0) !== 11 || blob.toString("latin1", 4, 15) !== "ssh-ed25519" || blob.readUInt32BE(15) !== 32) throw new Error("that is not an ed25519 key");
  if (!/^[a-z2-7]{10}$/.test(id ?? "")) throw new Error("this agent has no tunnel");
  if (!SAFE_PATH.test(node) || !SAFE_PATH.test(agent)) throw new Error("this server's paths cannot carry a direct link");
  return `restrict,command="${node} ${agent} direct" ssh-ed25519 ${match[1]} ${directTag(id)}`;
}

/** replaces this tunnel's line (or removes it with `line` null); every other line stays as it was */
export function setDirectKey(id, line, file = authorizedKeysFile()) {
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch (error) { if (error?.code !== "ENOENT") throw error; if (line === null) return; }
  const tag = directTag(id);
  const kept = text.split("\n").filter((entry) => entry && !entry.trimEnd().endsWith(` ${tag}`));
  if (line !== null) kept.push(line);
  writePrivate(file, kept.length ? `${kept.join("\n")}\n` : "");
}

/** at start: a key line written by an older node or agent path is pointed at this one (node moves on upgrades) */
export function refreshDirectKey(id, file = authorizedKeysFile(), paths = {}) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return false; }
  const old = text.split("\n").find((entry) => entry.trimEnd().endsWith(` ${directTag(id)}`));
  const pub = old && /(ssh-ed25519 [A-Za-z0-9+/]{68}) /.exec(old)?.[1];
  if (!pub) return false;
  const line = directKeyLine({ pub, id, ...paths });
  if (line === old.trimEnd()) return false;
  setDirectKey(id, line, file);
  return true;
}

const HOST_KEYS = ["ed25519", "ecdsa", "rsa"].map((type) => `/etc/ssh/ssh_host_${type}_key.pub`);
/** sshd's own public keys, which the app pins: they reach it inside the sealed tunnel, so nobody on the way can swap them */
export function hostKeys(files = HOST_KEYS) {
  const keys = [];
  for (const file of files) {
    try {
      const [type, body] = readFileSync(file, "utf8").trim().split(/\s+/);
      if (/^(ssh-ed25519|ecdsa-sha2-nistp(256|384|521)|ssh-rsa)$/.test(type) && /^[A-Za-z0-9+/]+={0,2}$/.test(body ?? "")) keys.push(`${type} ${body}`);
    } catch { /* not this type */ }
  }
  return keys;
}

const STUN = [["stun.l.google.com", 19302], ["stun.cloudflare.com", 3478]];
/** this server's public ipv4, as a stun server sees it (outbound udp: no port needs opening) */
export function publicAddress({ servers = STUN, timeoutMs = 2500 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    const tid = randomBytes(12);
    const done = (error, address) => { clearTimeout(timer); socket.close(); if (error) reject(error); else resolve(address); };
    const timer = setTimeout(() => done(new Error("no stun server answered")), timeoutMs);
    socket.on("error", (error) => done(error));
    socket.on("message", (message) => {
      if (message.length < 20 || !message.subarray(8, 20).equals(tid)) return;
      for (let at = 20; at + 4 <= message.length;) {
        const type = message.readUInt16BE(at), length = message.readUInt16BE(at + 2);
        if (type === 0x20 && length >= 8 && message[at + 5] === 1) return done(null, [0, 1, 2, 3].map((i) => message[at + 8 + i] ^ [0x21, 0x12, 0xa4, 0x42][i]).join("."));
        at += 4 + length + ((4 - (length % 4)) % 4);
      }
    });
    const request = Buffer.concat([Buffer.from([0, 1, 0, 0, 0x21, 0x12, 0xa4, 0x42]), tid]);
    for (const [host, port] of servers) socket.send(request, port, host, () => {});
  });
}

async function directKey(data, context) {
  if (process.env.OMB_LINK_DIRECT === "off") throw new Error("direct links are off on this server");
  const line = directKeyLine({ pub: data?.pub, id: context.id });
  const keys = hostKeys();
  if (!keys.length) throw new Error("this server's ssh keys could not be read");
  const host = process.env.OMB_LINK_DIRECT_HOST || await publicAddress();
  const port = Number(process.env.OMB_LINK_DIRECT_PORT) || 22;
  setDirectKey(context.id, line);
  return { v: 1, host, port, user: userInfo().username, hostKeys: keys };
}

export async function control(op, data, context = {}) {
  if (op === "ping") return { ok: true };
  if (op === "direct-key") return directKey(data, context);
  if (op === "direct-off") { if (context.id) setDirectKey(context.id, null); return { ok: true }; }
  if (op === "pair") {
    // a fresh one-time code for the app's own sign-in here, when its session lapsed (sessions end after 180 days)
    const answer = await local("POST", "/api/auth/pairing", { label: typeof data?.label === "string" ? data.label.slice(0, 60) : "OpenMausBot app" });
    if (answer.status !== 200 || typeof answer.body?.code !== "string") throw new Error("OpenMausBot here would not make a pairing code");
    return { code: answer.body.code };
  }
  if (op === "claude-token") {
    const value = typeof data?.token === "string" ? data.token.trim() : "";
    if (!/^[A-Za-z0-9._~+/=-]{20,4096}$/.test(value)) throw new Error("that is not a Claude token");
    let current = "";
    try { current = readFileSync(enginesFile(), "utf8"); } catch { /* none yet */ }
    // the path unit restarts openmausbot when this file changes, so the server's engines see the token
    writePrivate(enginesFile(), setEnvLine(current, "CLAUDE_CODE_OAUTH_TOKEN", value));
    return { ok: true };
  }
  if (op === "codex-auth") {
    const text = typeof data?.auth === "string" ? data.auth : "";
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error("that is not a ChatGPT sign-in"); }
    if (!parsed || typeof parsed !== "object" || text.length > 64 * 1024) throw new Error("that is not a ChatGPT sign-in");
    writePrivate(codexAuthFile(), text);
    return { ok: true };
  }
  if (op === "freeze" || op === "thaw") {
    const answer = op === "freeze"
      ? await local("POST", "/api/move/freeze", typeof data?.place === "string" ? { place: data.place.slice(0, 120) } : {})
      : await local("DELETE", "/api/move/freeze", undefined);
    if (answer.status !== 200) throw new Error(answer.body?.error ?? `OpenMausBot here answered ${answer.status}`);
    return { ok: true };
  }
  throw new Error("unknown request");
}

// ---- egress ----

/** the bridge every bot computer joins (shared/bot-desktop.ts BOT_DESKTOP_BRIDGE) and the proxy's port on it */
export const EGRESS_BRIDGE = "omb-desk0";
export const EGRESS_PORT = Number(process.env.LINK_EGRESS_PORT) || 3129;
/** the app says hello every 15 s while it takes streams; three missed and this server uses its own network again */
const EGRESS_SEEN_MS = 40_000;
const EGRESS_DIAL_MS = 5000;
const EGRESS_QUEUE_HIGH = 1024 * 1024;
const EGRESS_HEAD_MAX = 8 * 1024;
/**
 * socks5 replies. chromium 156 falls back to a direct connection on every failure reply and then skips the proxy for
 * minutes, so only "this computer cannot take it" fails that way; a destination this computer refuses or cannot reach
 * gets a success reply and an immediate close, which fails only that request.
 */
const SOCKS = { ok: 0, failure: 1, notAllowed: 2, unreachable: 4, refused: 5, command: 7, address: 8 };

/** the bridge's own ipv4 address and subnet, or null while docker has not made it */
export function bridgeAddress(name = EGRESS_BRIDGE, interfaces = networkInterfaces()) {
  const entry = (interfaces[name] ?? []).find((one) => one.family === "IPv4" || one.family === 4);
  if (!entry) return null;
  const [network, bits] = String(entry.cidr ?? `${entry.address}/24`).split("/");
  const subnet = new BlockList();
  subnet.addSubnet(network, Number(bits), "ipv4");
  return { host: entry.address, subnet };
}

function socksReply(code) { return Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]); }

/** reads a socks5 connect or an http connect off `socket`: `{ host, port, rest, reply(ok, code) }`, or null */
function readProxyHandshake(socket) {
  return new Promise((resolve) => {
    let buffered = Buffer.alloc(0), stage = "first", done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("end", gone);
      socket.off("close", gone);
      socket.pause();
      resolve(value);
    };
    const gone = () => finish(null);
    const timer = setTimeout(() => { socket.destroy(); finish(null); }, 10_000);
    const onData = (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length > EGRESS_HEAD_MAX) { socket.destroy(); return finish(null); }
      if (stage === "first") {
        if (buffered[0] === 5) stage = "socks-hello";
        else if (buffered[0] === 0x43) stage = "http";
        else { socket.destroy(); return finish(null); }
      }
      if (stage === "socks-hello") {
        if (buffered.length < 2 || buffered.length < 2 + buffered[1]) return;
        const methods = buffered.subarray(2, 2 + buffered[1]);
        buffered = buffered.subarray(2 + methods.length);
        if (!methods.includes(0)) { socket.end(Buffer.from([5, 0xff])); return finish(null); }
        socket.write(Buffer.from([5, 0]));
        stage = "socks-request";
      }
      if (stage === "socks-request") {
        if (buffered.length < 5) return;
        const [version, command, , type] = buffered;
        let host, at;
        if (type === 1) { if (buffered.length < 10) return; host = [...buffered.subarray(4, 8)].join("."); at = 8; }
        else if (type === 3) { const size = buffered[4]; if (buffered.length < 5 + size + 2) return; host = buffered.toString("latin1", 5, 5 + size); at = 5 + size; }
        else if (type === 4) {
          if (buffered.length < 22) return;
          const groups = [];
          for (let i = 4; i < 20; i += 2) groups.push(buffered.readUInt16BE(i).toString(16));
          host = groups.join(":"); at = 20;
        } else { socket.end(socksReply(SOCKS.address)); return finish(null); }
        if (version !== 5 || command !== 1) { socket.end(socksReply(SOCKS.command)); return finish(null); }
        const port = buffered.readUInt16BE(at);
        return finish({ host, port, rest: buffered.subarray(at + 2), reply: (ok, code) => socket.write(socksReply(ok ? SOCKS.ok : code ?? SOCKS.failure)), fail: () => socket.end(socksReply(SOCKS.ok)) });
      }
      if (stage === "http") {
        const end = buffered.indexOf("\r\n\r\n");
        if (end < 0) return;
        const line = buffered.toString("latin1", 0, buffered.indexOf("\r\n"));
        const match = /^CONNECT (\[[0-9a-f:.]+\]|[^\s:]+):(\d{1,5}) HTTP\/1\.[01]$/i.exec(line);
        if (!match) { socket.end("HTTP/1.1 405 Method Not Allowed\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"); return finish(null); }
        return finish({
          host: match[1].replace(/^\[|\]$/g, ""), port: Number(match[2]), rest: buffered.subarray(end + 4),
          reply: (ok, code) => socket.write(ok ? "HTTP/1.1 200 Connection Established\r\n\r\n"
            : `HTTP/1.1 ${code === SOCKS.notAllowed ? "403 Forbidden" : "502 Bad Gateway"}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`),
          fail: (code) => socket.end(`HTTP/1.1 ${code === SOCKS.notAllowed ? "403 Forbidden" : "502 Bad Gateway"}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`),
        });
      }
    };
    socket.on("data", onData);
    socket.once("end", gone);
    socket.once("close", gone);
  });
}

const egressCode = (code) => (code === "port" || code === "home-network" || code === "loopback" || code === "metadata" || code === "link-local" || code === "reserved"
  ? SOCKS.notAllowed : code === "refused" ? SOCKS.refused : code === "unreachable" ? SOCKS.unreachable : SOCKS.failure);

/**
 * the server's half of "route traffic through this computer": a proxy the bot computers reach on their bridge, whose
 * connections the app opens from the person's own computer. it rides any tunnel with the stream api `send(frame)`,
 * `bytes(r, chunk)`, `queued()` and `onDrain(fn)`, and takes the app's frames through `handle(frame)`.
 * Security: it never connects anywhere itself (a box reaching this host must not get past the host fence), only
 * answers on the bridge, and refuses the bridge's own address so processes on this host cannot use it. the app checks
 * every destination again on its side.
 */
export function createEgressProxy({
  send, bytes, queued, onDrain, log = () => {}, now = Date.now,
  bind = () => bridgeAddress(), port = EGRESS_PORT, report = null, reportMs = 5000, dialMs = EGRESS_DIAL_MS,
}) {
  const streams = new Map();
  let seenAt = 0, ready = false, enabled = report === null, server = null, listening = null, timer = null, stopped = false;
  const stats = { relayed: 0, refused: 0, fallbacks: 0 };
  const online = () => ready && now() - seenAt < EGRESS_SEEN_MS;
  const randomId = () => Array.from(randomBytes(12), (byte) => "abcdefghijklmnopqrstuvwxyz234567"[byte & 31]).join("");

  function forget(r, tell) {
    const entry = streams.get(r);
    if (!entry) return;
    streams.delete(r);
    clearTimeout(entry.timer);
    entry.settle?.({ ok: false, code: "closed" });
    entry.socket.destroy();
    if (tell) send({ t: "cancel", r });
  }

  /** the app went away: its streams are dead, so their browsers see the close now instead of waiting */
  function gone() {
    ready = false;
    for (const [r, entry] of streams) {
      if (entry.settle) { const settle = entry.settle; entry.settle = null; clearTimeout(entry.timer); settle({ ok: false, code: "closed" }); }
      else if (entry.relaying) forget(r, false);
    }
  }

  async function accept(socket, allowed) {
    socket.on("error", () => {});
    const remote = String(socket.remoteAddress ?? "").replace(/^::ffff:/, "");
    if (!allowed(remote)) { socket.destroy(); return; }
    const asked = await readProxyHandshake(socket);
    if (!asked || stopped) { socket.destroy(); return; }
    const fallBack = () => { stats.refused += 1; stats.fallbacks += 1; asked.reply(false, SOCKS.failure); socket.end(); };
    if (!enabled || !online()) return fallBack();
    const r = randomId();
    const answer = await new Promise((settle) => {
      const entry = { socket, settle, endSent: false, timer: setTimeout(() => {
        // the app did not answer in time: it is asleep or gone, so new connections go direct until it says hello again
        log("egress: the app did not answer; bot computers use this server's own network until it is back");
        entry.settle = null;
        settle({ ok: false, code: "timeout" });
        gone();
      }, dialMs) };
      streams.set(r, entry);
      send({ t: "dial", r, host: asked.host, port: asked.port });
    });
    const entry = streams.get(r);
    if (!answer.ok || !entry) {
      if (entry) { streams.delete(r); clearTimeout(entry.timer); if (answer.code === "timeout") send({ t: "cancel", r }); }
      if (answer.code === "timeout" || answer.code === "busy" || answer.code === "closed") return fallBack();
      stats.refused += 1;
      return asked.fail(egressCode(answer.code));
    }
    stats.relayed += 1;
    entry.relaying = true;
    asked.reply(true);
    if (asked.rest.length) bytes(r, asked.rest);
    socket.setNoDelay(true);
    socket.on("data", (chunk) => {
      if (streams.get(r) !== entry) return;
      bytes(r, chunk);
      if (queued() >= EGRESS_QUEUE_HIGH) { socket.pause(); onDrain(() => { if (streams.get(r) === entry) socket.resume(); }); }
    });
    socket.on("end", () => { if (streams.get(r) === entry) { entry.endSent = true; send({ t: "end", r }); } });
    socket.on("close", () => { if (streams.get(r) === entry) forget(r, !entry.endSent); });
    socket.resume();
  }

  async function relisten() {
    if (stopped) return;
    const want = bind();
    if (listening && want && listening.host === want.host) return;
    if (server) { const old = server; server = null; listening = null; await new Promise((resolve) => old.close(() => resolve())); }
    if (!want) return;
    const allowed = want.allow ?? ((address) => address !== want.host && want.subnet.check(address, "ipv4"));
    const next = createTcpServer((socket) => void accept(socket, allowed));
    try {
      await new Promise((resolve, reject) => { next.once("error", reject); next.listen(want.port ?? port, want.host, () => resolve()); });
      server = next;
      listening = { host: want.host, port: next.address().port };
      log(`egress: bot computers can route through the app at ${listening.host}:${listening.port}`);
    } catch (error) {
      log(`egress: could not listen on ${want.host}:${port} (${error?.code ?? error?.message ?? error})`);
    }
  }

  async function tick() {
    await relisten();
    if (!report || stopped) return;
    try {
      const said = await report({ online: online(), proxy: listening, active: streams.size, ...stats });
      if (typeof said?.enabled === "boolean") enabled = said.enabled;
    } catch { /* the server is restarting; the last answer stands */ }
  }

  return {
    get listening() { return listening; },
    get enabled() { return enabled; },
    online,
    stats: () => ({ ...stats, active: streams.size }),
    async start() {
      await tick();
      timer = setInterval(() => void tick(), reportMs);
      timer.unref?.();
    },
    /** the app's frames: hello, dial answers and the bytes of streams this proxy opened */
    handle(frame) {
      if (frame?.t === "egress") {
        const was = online();
        if (frame.ready === true) { ready = true; seenAt = now(); }
        else { gone(); seenAt = 0; }
        if (was !== online()) { log(online() ? "egress: the app takes streams again" : "egress: the app stopped taking streams"); void tick(); }
        return true;
      }
      const entry = typeof frame?.r === "string" ? streams.get(frame.r) : undefined;
      if (!entry) return frame?.t === "dialed";
      if (frame.t === "dialed") {
        clearTimeout(entry.timer);
        seenAt = now();
        ready = true;
        entry.settle?.(frame.ok === true ? { ok: true } : { ok: false, code: typeof frame.code === "string" ? frame.code : "unreachable" });
        entry.settle = null;
      } else if (frame.t === "bytes") {
        if (entry.socket.writableLength + frame.b.length > 8 * 1024 * 1024) forget(frame.r, true);
        else entry.socket.write(frame.b);
      } else if (frame.t === "end") entry.socket.end();
      else if (frame.t === "cancel") forget(frame.r, false);
      else return false;
      return true;
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      for (const r of streams.keys()) forget(r, false);
      if (server) await new Promise((resolve) => server.close(() => resolve()));
      server = null;
      listening = null;
    },
  };
}

// ---- end egress ----

/**
 * what the app's frames ask of this server, over either path: requests and websockets to OpenMausBot, control ops to this
 * agent. `sink` takes the replies: push(frame), bytes(r, chunk) (false: pause), onDrain(resume), discard(r).
 */
export function createServing({ server = SERVER, sink, stopped = () => false, context = {} }) {
  const pending = new Map();
  const emit = (frame) => { if (!stopped()) sink.push(frame); };

  function overflow(r) {
    const entry = pending.get(r);
    if (!entry) return;
    pending.delete(r);
    entry.destroy();
    sink.discard(r);
    emit({ t: "err", r, message: "The destination could not keep up with this transfer. Try again." });
  }

  function writeTo(r, destination, chunk) {
    if (!pending.has(r)) return;
    if (destination.writableLength + chunk.length > RECEIVE_HIGH) { overflow(r); return; }
    destination.write(chunk);
  }

  /** a websocket the app opened: the server answers its handshake, then the socket's bytes cross both ways */
  function upgraded(frame, early, res, socket, head) {
    const out = {};
    for (const [name, value] of Object.entries(res.headers)) if (!HOP.has(name)) out[name] = value;
    emit({ t: "head", r: frame.r, status: 101, headers: out, up: true });
    socket.setNoDelay(true);
    pending.set(frame.r, { write: (chunk) => writeTo(frame.r, socket, chunk), end: () => socket.end(), destroy: () => socket.destroy() });
    for (const chunk of early) writeTo(frame.r, socket, chunk);
    const read = (chunk) => { if (pending.has(frame.r) && !sink.bytes(frame.r, chunk)) { socket.pause(); sink.onDrain(() => socket.resume()); } };
    if (head.length) read(head);
    socket.on("data", read);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => { if (pending.delete(frame.r)) emit({ t: "end", r: frame.r }); });
  }

  function startRequest(frame) {
    const headers = {};
    for (const [name, value] of Object.entries(frame.headers ?? {})) if (!HOP.has(name.toLowerCase())) headers[name] = value;
    if (frame.up === true) { headers.connection = "Upgrade"; headers.upgrade = "websocket"; }
    // marks every tunnelled request as remote (server/request-auth.ts isProxied): it needs a paired session, never loopback trust
    headers["x-forwarded-for"] = "192.0.2.10";
    headers["x-forwarded-proto"] = "http";
    if (headers.host) headers["x-forwarded-host"] = headers.host;
    let reply = null;
    const req = httpRequest({ ...server, method: frame.method, path: frame.path, headers }, (res) => {
      reply = res;
      if (!pending.has(frame.r) || stopped()) { res.destroy(); return; }
      const out = {};
      for (const [name, value] of Object.entries(res.headers)) if (!HOP.has(name)) out[name] = value;
      emit({ t: "head", r: frame.r, status: res.statusCode ?? 502, headers: out });
      res.on("data", (chunk) => {
        if (!pending.has(frame.r) || stopped()) return;
        if (!sink.bytes(frame.r, chunk)) {
          res.pause();
          sink.onDrain(() => { if (pending.has(frame.r)) res.resume(); });
        }
      });
      res.on("end", () => { if (pending.delete(frame.r)) emit({ t: "end", r: frame.r }); });
      res.on("error", () => { if (pending.delete(frame.r)) emit({ t: "err", r: frame.r, message: "reply cut off" }); });
    });
    req.on("error", () => { if (pending.delete(frame.r)) emit({ t: "err", r: frame.r, message: "OpenMausBot on the server did not answer" }); });
    // bytes the app sent before the handshake was answered wait for the socket
    const early = [];
    let earlyBytes = 0;
    if (frame.up === true) req.on("upgrade", (res, socket, head) => { if (pending.has(frame.r)) upgraded(frame, early, res, socket, head); else socket.destroy(); });
    pending.set(frame.r, frame.up === true
      ? { write: (chunk) => {
        if (earlyBytes + chunk.length > RECEIVE_HIGH) { overflow(frame.r); return; }
        early.push(chunk);
        earlyBytes += chunk.length;
      }, end: () => {}, destroy: () => req.destroy() }
      : { write: (chunk) => writeTo(frame.r, req, chunk), end: () => req.end(), destroy: () => { reply?.destroy(); req.destroy(); } });
    if (frame.end) req.end();
  }

  async function handle(frame) {
    if (frame.t === "req" && typeof frame.r === "string" && typeof frame.path === "string" && frame.path.startsWith("/")) return startRequest(frame);
    if (frame.t === "body") {
      const req = pending.get(frame.r);
      if (!req) return;
      if (frame.d) req.write(Buffer.from(frame.d, "base64"));
      if (frame.end) req.end();
      return;
    }
    if (frame.t === "bytes") { pending.get(frame.r)?.write(frame.b); return; }
    if (frame.t === "cancel") { pending.get(frame.r)?.destroy(); pending.delete(frame.r); sink.discard(frame.r); return; }
    if (frame.t === "ctl") {
      try { emit({ t: "ctl", r: frame.r, ok: true, data: await control(frame.op, frame.data, context) }); }
      catch (error) { emit({ t: "ctl", r: frame.r, ok: false, error: error?.message ?? String(error) }); }
    }
  }

  return {
    handle,
    destroyAll() { for (const req of pending.values()) req.destroy(); pending.clear(); },
  };
}

/** `egress`: options for createEgressProxy, which then rides this tunnel; without it the app's hellos are ignored */
export function createTunnelAgent({ base, id, key: keyText, token, server = SERVER, fetchImpl: given, log = (line) => console.error(line), stallMs = STREAM_STALL_MS, egress: egressOptions = null }) {
  const fetchImpl = given ?? keepAliveFetch();
  const stream = streamChoice();
  const key = Buffer.from(keyText, "base64url");
  const guard = frameGuard();
  let stopped = false;
  let terminal = "stopped";
  let successfulPosts = 0, pollRetry = null;
  const abort = new AbortController();

  function stop(reason = "stopped") {
    if (stopped) return;
    stopped = true;
    terminal = reason;
    abort.abort();
    void egress?.stop();
    if (!given) fetchImpl.close();
    serving.destroyAll();
  }

  const wait = (ms) => delay(ms, undefined, { signal: abort.signal }).catch(() => {});

  const epoch = Array.from(randomBytes(12), (byte) => "abcdefghijklmnopqrstuvwxyz234567"[byte & 31]).join("");
  let ordered = false;
  const post = async (frames, at) => {
    for (let attempt = 0; !stopped; attempt += 1) {
      try {
        const response = await fetchImpl(`${base}/v1/tunnels/${id}/to-app`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ frames, epoch, seq: at }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]) });
        // read, not cancelled: a cancelled body closes the socket the next post would reuse
        const said = await response.text().catch(() => "");
        if (response.ok && !ordered) ordered = /"ordered":true/.test(said);
        if (response.ok) { successfulPosts += 1; pollRetry?.abort(); return true; }
        if (response.status === 404) { stop("unlinked"); return false; }
      } catch { /* retried below */ }
      if (stopped) break;
      await wait(Math.min(5000, 200 * 2 ** attempt));
    }
    return false;
  };
  // no wait: what arrives in one turn goes in one post at once, and more coalesce while posts are out
  const outbox = createOutbox({ seal: (r, bytes) => sealBytes(key, id, "to-app", r, bytes), post, delayMs: 0, signal: abort.signal, parallel: () => (ordered ? POSTS_IN_FLIGHT : 1), onError: () => { log("link: reply queue failed; restarting the tunnel"); stop(); } });
  const emit = (frame) => { if (!stopped) outbox.push(sealFrame(key, id, "to-app", frame), frame.r); };
  const serving = createServing({
    server, stopped: () => stopped, context: { id },
    sink: { push: emit, bytes: outbox.bytes, onDrain: outbox.onDrain, discard: outbox.discard },
  });
  const egress = egressOptions ? createEgressProxy({ send: emit, bytes: (r, chunk) => outbox.bytes(r, chunk), queued: () => outbox.size, onDrain: (resume) => outbox.onDrain(resume), log, ...egressOptions }) : null;
  const handle = (frame) => (egress?.handle(frame) ? undefined : serving.handle(frame));

  async function run() {
    let failures = 0;
    const unwarm = given ? () => {} : fetchImpl.warm(base);
    void egress?.start();
    while (!stopped) {
      const postsBefore = successfulPosts;
      const streaming = stream.wanted();
      const stall = new AbortController();
      let heard = false;
      let stallTimer = null;
      const armStall = () => { if (streaming && !stallTimer) stallTimer = setTimeout(() => { if (!heard) stall.abort(); }, stallMs); };
      if (!fetchImpl.connectAware) armStall();
      try {
        const response = await fetchImpl(`${base}/v1/tunnels/${id}/to-vps?wait=25${streaming ? "&stream=1" : ""}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.any([abort.signal, stall.signal, AbortSignal.timeout(40_000)]), onConnected: armStall });
        if (response.status === 404) {
          log("link: this server was unlinked in the app; the tunnel stops");
          stop("unlinked");
          unwarm();
          return "unlinked";
        }
        if (!response.ok) throw new Error(`link service answered ${response.status}`);
        await readFrameBatches(response, (frames) => {
          heard = true;
          failures = 0;
          for (const sealed of frames) {
            let frame = null;
            try { frame = openFrame(key, id, "to-vps", sealed, guard); } catch { log("link: dropped a frame that did not open"); }
            if (frame) void handle(frame);
          }
        });
      } catch (error) {
        if (stopped) break;
        if (stall.signal.aborted && !heard) {
          stream.stalled();
          log("link: the link service's streamed requests were held back; polling instead");
          continue;
        }
        failures += 1;
        if (failures === 1 || failures % 20 === 0) log(`link: tunnel retrying (${error?.message ?? error})`);
        if (postsBefore === successfulPosts) {
          pollRetry = new AbortController();
          await delay(Math.min(30_000, 500 * 2 ** Math.min(failures, 6)), undefined, { signal: AbortSignal.any([abort.signal, pollRetry.signal]) }).catch(() => {});
          pollRetry = null;
        }
      } finally { clearTimeout(stallTimer); }
    }
    unwarm();
    return terminal;
  }
  return { run, stop, egress };
}

/**
 * the direct link's server half, one per ssh connection: frames in on `input`, replies out on `output`. it says hello
 * first (sealed, so the app knows it holds the key), answers pings, and ends with the connection.
 */
export function serveDirect({ input, output, id, key: keyText, server = SERVER, log = (line) => console.error(line), idleMs = 20_000 }) {
  const key = Buffer.from(keyText, "base64url");
  const guard = frameGuard();
  let ended = false, heard = false, finish;
  const done = new Promise((resolve) => { finish = (why) => {
    if (ended) return;
    ended = true;
    clearTimeout(idle);
    writer.close();
    serving.destroyAll();
    output.end?.();
    resolve(why);
  }; });
  const writer = createDirectWriter({
    sealFrame: (frame) => sealFrame(key, id, "to-app", frame, true),
    sealBytes: (r, bytes) => sealBytes(key, id, "to-app", r, bytes, true),
    write: (record) => !ended && output.write(record),
  });
  const serving = createServing({ server, sink: writer, stopped: () => ended, context: { id } });
  // nothing that opens within a while: not the app, so this process does not linger
  const idle = setTimeout(() => { if (!heard) finish("idle"); }, idleMs);
  const read = directReader((type, payload) => {
    if (type === REC_ACK && payload.length === 4) { writer.acked(payload.readUInt32BE(0)); return; }
    if (type !== REC_SEALED) return;
    let frame = null;
    try { frame = openFrame(key, id, "to-vps", payload, guard); } catch { log("link direct: dropped a frame that did not open"); }
    if (!frame) return;
    heard = true;
    if (frame.t === "bytes") writer.received(frame.b.length);
    if (frame.t === "ping") { writer.push({ t: "pong", n: frame.n }); return; }
    if (frame.t !== "hello") void serving.handle(frame);
  });
  output.on("drain", () => writer.drained());
  output.on("error", () => finish("closed"));
  input.on("data", (chunk) => { if (ended) return; try { read(chunk); } catch (error) { log(`link direct: ${error.message}`); finish("malformed"); } });
  input.on("end", () => finish("closed"));
  input.on("close", () => finish("closed"));
  output.write(DIRECT_MAGIC);
  writer.push({ t: "hello", v: 1 });
  return { done, stop: () => finish("stopped") };
}

async function direct() {
  let saved;
  try { saved = JSON.parse(readFileSync(tunnelFile(), "utf8")); } catch { console.error("link: not linked yet"); return 1; }
  // a socket on the pipe, not process.stdout: on linux a piped stdout writes synchronously and would stall the reads
  const output = new Socket({ fd: 1, readable: false, writable: true });
  const why = await serveDirect({ input: process.stdin, output, id: saved.id, key: saved.key }).done;
  return why === "closed" || why === "stopped" ? 0 : 1;
}

async function tunnel() {
  let saved;
  try { saved = JSON.parse(readFileSync(tunnelFile(), "utf8")); } catch { console.error("link: not linked yet; nothing to do"); return 0; }
  try { if (refreshDirectKey(saved.id)) console.error("link: the app's direct key now runs this agent"); } catch (error) { console.error(`link: the app's direct key was not refreshed (${error?.message ?? error})`); }
  const agent = createTunnelAgent({ ...saved, egress: {
    report: async (state) => { const answer = await local("POST", "/api/computer/egress/agent", state); return answer.status === 200 ? answer.body : null; },
  } });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { agent.stop(); process.exit(0); });
  const how = await agent.run();
  // unlinked: stay quiet instead of letting systemd restart a tunnel that no longer exists
  if (how === "unlinked") {
    try { setDirectKey(saved.id, null); } catch (error) { console.error(`link: the app's ssh key could not be removed (${error?.message ?? error})`); }
    setInterval(() => {}, 1 << 30);
    await new Promise(() => {});
  }
  return 0;
}

const main = { probe, link, tunnel, direct };
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = main[process.argv[2]];
  if (!command) { console.error("usage: node agent.mjs probe|link|tunnel|direct"); process.exit(2); }
  command().then((code) => process.exit(code ?? 0), (error) => { console.error(error?.message ?? String(error)); process.exit(1); });
}
