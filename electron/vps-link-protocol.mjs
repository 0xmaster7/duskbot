// the app's half of linking a vps (link-service/agent.mjs is the server's half; the crypto block is the same in both and
// a test proves they interoperate). the link service only ever sees verifiers, public keys and sealed blobs.
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import { Agent as HttpAgent, STATUS_CODES, createServer, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";

import { createDirectLink } from "./vps-link-direct.mjs";

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
  const settle = () => (delayMs > 0 ? sleep(delayMs, undefined, { signal }) : new Promise((resolve) => setImmediate(resolve)));
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

const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "content-length", "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "forwarded"]);

export function randomB32(length) {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += B32[bytes[i] & 31];
  return out;
}

// ---- crypto shared with link-service/agent.mjs ----
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

// ---- relay transport shared with link-service/agent.mjs ----
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
  /** after a sleep or a network change: every socket may be dead, so the next requests open fresh ones */
  go.reset = go.close;
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
/** a websocket (the live desktop) opened while the direct path is dialling waits this long for it before taking the relay */
const UPGRADE_HOLD_MS = 4000;

/**
 * the app's end of the tunnel: a loopback http server at http://vps-<id>.localhost:<port> whose requests travel to the
 * vps sealed, and whose replies stream back the same way. only that host name is served. two paths carry the frames:
 * the relay, always there, and the direct path (vps-link-direct.mjs) once `useDirect` gave it a way to connect. each
 * request takes the best path when it starts and keeps it; a lost direct path sends a request that had no answer yet
 * and can safely be sent again over the relay, and fails the rest.
 * `egress`: makes this app's end of "route traffic through this computer" (vps-link-egress.mjs createEgressEndpoint) from
 * the tunnel's stream api; without it the vps's stream requests go unanswered. it always rides the relay, where the
 * agent's half of it lives.
 */
export function createTunnelProxy({ base, id, key: keyText, token, port = 0, fetch: given, log = () => {}, replyTimeoutMs = 90_000, stallMs = STREAM_STALL_MS, direct: directSpec = null, directFactory = createDirectLink, egress: makeEgress = null }) {
  const fetchImpl = given ?? keepAliveFetch();
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
  async function post(frames, at) {
    for (let attempt = 0; !closed; attempt += 1) {
      try {
        const response = await fetchImpl(`${base}/v1/tunnels/${id}/to-vps`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ frames, epoch, seq: at }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]) });
        // read, not cancelled: a cancelled body closes the socket the next post would reuse
        const said = await response.text().catch(() => "");
        if (response.ok && !ordered) ordered = /"ordered":true/.test(said);
        if (response.ok) { successfulPosts += 1; pollRetry?.abort(); return true; }
        if (response.status === 404) { closed = true; abort.abort(); fail("This server was unlinked."); return false; }
      } catch { if (closed) return false; }
      if (attempt >= 6) { fail("The link service did not answer."); return false; }
      await sleep(Math.min(5000, 200 * 2 ** attempt), undefined, { signal: abort.signal }).catch(() => {});
    }
    return false;
  }
  const outbox = createOutbox({ seal: (r, bytes) => sealBytes(key, id, "to-vps", r, bytes), post, delayMs: 0, signal: abort.signal, parallel: () => (ordered ? POSTS_IN_FLIGHT : 1), onError: () => fail("The link service did not answer.") });
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
  const egress = makeEgress?.({ send: relayPath.push, bytes: (r, chunk) => outbox.bytes(r, chunk), queued: () => outbox.size, onDrain: (resume) => outbox.onDrain(resume), log }) ?? null;

  function directChanged({ state, lost }) {
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
    direct = directFactory({ id, key: keyText, guard, connect: spec.connect, onFrame: (frame) => deliver(frame), onChange: directChanged, onFailure: spec.onFailure ?? (() => {}), log });
    direct.start();
  }

  function deliver(frame) {
    if (egress?.handle(frame)) return;
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
    let failures = 0;
    while (!closed) {
      const postsBefore = successfulPosts;
      const streaming = stream.wanted();
      const stall = new AbortController();
      let heard = false;
      let stallTimer = null;
      const armStall = () => { if (streaming && !stallTimer) stallTimer = setTimeout(() => { if (!heard) stall.abort(); }, stallMs); };
      if (!fetchImpl.connectAware) armStall();
      const nudged = (pollNudge = new AbortController());
      try {
        const response = await fetchImpl(`${base}/v1/tunnels/${id}/to-app?wait=25${streaming ? "&stream=1" : ""}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.any([abort.signal, stall.signal, nudged.signal, AbortSignal.timeout(40_000)]), onConnected: armStall });
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
        if (nudged.signal.aborted) continue;
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
      } finally { clearTimeout(stallTimer); }
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
    const dialling = direct && !direct.ready() && ["connecting", "up"].includes(direct.state());
    if (!dialling) { upgradeVia(req, socket, head, pick()); return; }
    socket.pause();
    void direct.whenUp(UPGRADE_HOLD_MS).then(() => { if (!socket.destroyed && !closed) { socket.resume(); upgradeVia(req, socket, head, pick()); } else socket.destroy(); });
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
        if (open) socket.on("data", read);
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
