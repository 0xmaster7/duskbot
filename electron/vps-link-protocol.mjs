// the app's half of linking a vps (link-service/agent.mjs is the server's half; the crypto block is the same in both and
// a test proves they interoperate). the link service only ever sees verifiers, public keys and sealed blobs.
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import { STATUS_CODES, createServer } from "node:http";

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
const FRAME_SKEW_MS = 5 * 60_000;
const CHUNK = 128 * 1024;
/** one post stays well under a proxy's usual 1 MB body limit (nginx's default) */
const BATCH_BYTES = 700 * 1024;
export function takeBatch(outbox) {
  let size = 0, count = 0;
  while (count < outbox.length && count < 64 && (count === 0 || size + outbox[count].length <= BATCH_BYTES)) size += outbox[count++].length;
  return outbox.splice(0, count);
}

/** a websocket's bytes wait here at most this much before its socket is paused (the link service queues 16 MB a side) */
const STREAM_HIGH = 2 * 1024 * 1024;
const STREAM_LOW = 512 * 1024;
/**
 * frames waiting for the one post in flight (kept in step with the other end of the tunnel). a stream's bytes join its
 * last waiting piece and are sealed only when sent, so a busy websocket costs a few frames per post, not one per chunk.
 */
export function createOutbox({ seal: sealRaw, post, delayMs }) {
  const items = [];
  const drains = new Set();
  let flushing = null;
  const queued = () => items.reduce((sum, item) => sum + (typeof item === "string" ? item.length : item.size), 0);
  function kick() {
    if (flushing) return;
    flushing = (async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      while (items.length) {
        for (let at = 0; at < items.length; at += 1) {
          const item = items[at];
          if (typeof item !== "string") items[at] = sealRaw(item.r, item.parts.length === 1 ? item.parts[0] : Buffer.concat(item.parts));
        }
        if ((await post(takeBatch(items))) === false) items.length = 0;
        if (drains.size && queued() < STREAM_LOW) { const waiting = [...drains]; drains.clear(); for (const resume of waiting) resume(); }
      }
      flushing = null;
      if (drains.size) { const waiting = [...drains]; drains.clear(); for (const resume of waiting) resume(); }
    })();
  }
  return {
    push(sealed) { items.push(sealed); kick(); },
    /** false: stop reading this stream until `onDrain` calls back */
    bytes(r, chunk) {
      const last = items[items.length - 1];
      if (last && typeof last !== "string" && last.r === r && last.size + chunk.length <= CHUNK) { last.parts.push(chunk); last.size += chunk.length; }
      else for (let at = 0; at < chunk.length; at += CHUNK) {
        const part = chunk.subarray(at, at + CHUNK);
        items.push({ r, parts: [part], size: part.length });
      }
      kick();
      return queued() < STREAM_HIGH;
    },
    onDrain(resume) { drains.add(resume); },
    get size() { return queued(); },
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
export function seal(key, aad, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}
export function open(key, aad, sealed) {
  const raw = Buffer.from(sealed, "base64url");
  if (raw.length < 29) throw new Error("sealed value too short");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
}
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
export function sealFrame(key, id, dir, frame) {
  return seal(key, `${id}|${dir}`, Buffer.from(JSON.stringify({ ...frame, ts: Date.now() })));
}
/** a websocket's bytes travel raw, not as base64 in json: 0x01, the 12-letter stream id, the time, then the bytes */
export function sealBytes(key, id, dir, r, bytes) {
  const head = Buffer.alloc(21);
  head[0] = 1;
  head.write(r, 1, 12, "latin1");
  head.writeDoubleBE(Date.now(), 13);
  return seal(key, `${id}|${dir}`, Buffer.concat([head, bytes]));
}
export function openFrame(key, id, dir, sealed, guard) {
  const plain = open(key, `${id}|${dir}`, sealed);
  const value = plain[0] === 1 && plain.length >= 21
    ? { t: "bytes", r: plain.toString("latin1", 1, 13), ts: plain.readDoubleBE(13), b: plain.subarray(21) }
    : JSON.parse(plain.toString("utf8"));
  if (guard && !guard(sealed.slice(0, 16), value.ts)) return null;
  return value;
}
// ---- end shared crypto ----

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
    create: (body) => call("POST", "/v1/sessions", null, body),
    watch: (id, watch, after, signal) => call("GET", `/v1/sessions/${id}/events?after=${after}&wait=25`, watch, undefined, signal ?? AbortSignal.timeout(40_000)),
    cancel: (id, watch) => call("DELETE", `/v1/sessions/${id}`, watch),
    forget: (id, token) => call("DELETE", `/v1/tunnels/${id}`, token),
    status: (id, token) => call("GET", `/v1/tunnels/${id}/status`, token),
  };
}

/**
 * the app's end of the relay tunnel: a loopback http server at http://vps-<id>.localhost:<port> whose requests travel to
 * the vps sealed, and whose replies stream back the same way. only that host name is served.
 */
export function createTunnelProxy({ base, id, key: keyText, token, port = 0, fetch: fetchImpl = fetch, log = () => {}, replyTimeoutMs = 90_000 }) {
  const key = Buffer.from(keyText, "base64url");
  const guard = frameGuard();
  const host = `vps-${id}.localhost`;
  const waiting = new Map();
  let server = null, server6 = null, polling = false, closed = false, listeningPort = port;
  const abort = new AbortController();

  async function post(frames) {
    for (let attempt = 0; !closed; attempt += 1) {
      try {
        const response = await fetchImpl(`${base}/v1/tunnels/${id}/to-vps`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ frames }), signal: AbortSignal.timeout(60_000) });
        if (response.ok) return true;
        if (response.status === 404) { fail("This server was unlinked."); return false; }
      } catch { /* retried */ }
      if (attempt >= 6) { fail("The link service did not answer."); return false; }
      await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 200 * 2 ** attempt)));
    }
    return false;
  }
  const outbox = createOutbox({ seal: (r, bytes) => sealBytes(key, id, "to-vps", r, bytes), post, delayMs: 5 });
  const emit = (frame) => outbox.push(sealFrame(key, id, "to-vps", frame));
  function fail(message) {
    for (const entry of waiting.values()) entry.fail(message);
    waiting.clear();
  }

  function deliver(frame) {
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
      try {
        const response = await fetchImpl(`${base}/v1/tunnels/${id}/to-app?wait=25`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(40_000)]) });
        if (response.status === 404) { fail("This server was unlinked."); break; }
        if (!response.ok) throw new Error(`link service answered ${response.status}`);
        const { frames = [] } = await response.json();
        failures = 0;
        for (const sealed of frames) {
          let frame = null;
          try { frame = openFrame(key, id, "to-app", sealed, guard); } catch { log("vps link: dropped a frame that did not open"); }
          if (frame) deliver(frame);
        }
      } catch (error) {
        if (closed) break;
        failures += 1;
        if (failures === 1 || failures % 20 === 0) log(`vps link: tunnel retrying (${error?.message ?? error})`);
        await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, 300 * 2 ** Math.min(failures, 6))));
      }
    }
    polling = false;
  }

  function onRequest(req, res) {
    const hostHeader = String(req.headers.host ?? "");
    if (hostHeader !== `${host}:${listeningPort}`) { res.writeHead(421, { "content-type": "text/plain" }); res.end("wrong host"); return; }
    const r = randomB32(12);
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) if (!HOP.has(name)) headers[name] = value;
    let timer = null;
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => { waiting.delete(r); emit({ t: "cancel", r }); answer(504, "The server took too long to answer."); }, replyTimeoutMs); };
    const answer = (status, message) => {
      clearTimeout(timer);
      if (!res.headersSent) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify({ error: message })); }
      else res.destroy();
    };
    waiting.set(r, {
      touch,
      head: (status, out) => { res.writeHead(status, out); res.flushHeaders?.(); },
      data: (chunk) => res.write(chunk),
      end: () => { clearTimeout(timer); res.end(); },
      fail: (message) => answer(502, message),
      ctl: () => {},
    });
    touch();
    res.on("close", () => { clearTimeout(timer); if (waiting.delete(r)) emit({ t: "cancel", r }); });
    const bodyless = req.method === "GET" || req.method === "HEAD" || req.headers["content-length"] === "0";
    emit({ t: "req", r, method: req.method, path: req.url, headers, end: bodyless });
    if (bodyless) return;
    req.on("data", (chunk) => { for (let at = 0; at < chunk.length; at += CHUNK) emit({ t: "body", r, d: chunk.subarray(at, at + CHUNK).toString("base64") }); });
    req.on("end", () => emit({ t: "body", r, end: true }));
  }

  /** a websocket (the live desktop): the handshake travels like a request, then its bytes both ways, raw and sealed */
  function onUpgrade(req, socket, head) {
    socket.on("error", () => socket.destroy());
    if (String(req.headers.host ?? "") !== `${host}:${listeningPort}`) { socket.end("HTTP/1.1 421 Misdirected Request\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"); return; }
    socket.setNoDelay(true);
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
    const touch = () => { if (open) return; clearTimeout(timer); timer = setTimeout(() => { if (waiting.delete(r)) emit({ t: "cancel", r }); refuse(504, "The server took too long to answer."); }, replyTimeoutMs); };
    const read = (chunk) => { if (!outbox.bytes(r, chunk)) { socket.pause(); outbox.onDrain(() => socket.resume()); } };
    waiting.set(r, {
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
      data: (chunk) => socket.write(chunk),
      end: () => { clearTimeout(timer); socket.end(); },
      fail: (message) => refuse(502, message),
      ctl: () => {},
    });
    touch();
    socket.on("close", () => { clearTimeout(timer); if (waiting.delete(r)) emit({ t: "cancel", r }); });
    emit({ t: "req", r, method: req.method, path: req.url, headers, end: true, up: true });
    if (head?.length) outbox.bytes(r, head);
  }

  return {
    host,
    origin: () => `http://${host}:${listeningPort}`,
    async start() {
      if (server) return `http://${host}:${listeningPort}`;
      server = createServer(onRequest);
      server.on("upgrade", onUpgrade);
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => resolve()); });
      listeningPort = server.address().port;
      // *.localhost resolves to ::1 first for node's fetch, so the same port answers on ipv6 loopback too
      const v6 = createServer(onRequest);
      v6.on("upgrade", onUpgrade);
      await new Promise((resolve) => { v6.once("error", () => resolve()); v6.listen(listeningPort, "::1", () => { server6 = v6; resolve(); }); });
      void poll();
      return `http://${host}:${listeningPort}`;
    },
    /** a request for the agent itself (credentials, pausing the server), answered over the same sealed tunnel */
    control(op, data, timeoutMs = 30_000) {
      void poll();
      const r = randomB32(12);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(r); reject(new Error("Your server did not answer. Is it on?")); }, timeoutMs);
        waiting.set(r, { touch: () => {}, head: () => {}, data: () => {}, end: () => {}, fail: (message) => { clearTimeout(timer); reject(new Error(message)); },
          ctl: (frame) => { clearTimeout(timer); if (frame.ok) resolve(frame.data ?? { ok: true }); else reject(new Error(frame.error ?? "Your server said no.")); } });
        emit({ t: "ctl", r, op, data });
      });
    },
    async close() {
      closed = true;
      abort.abort();
      fail("closed");
      if (server) await new Promise((resolve) => server.close(() => resolve()));
      if (server6) await new Promise((resolve) => server6.close(() => resolve()));
      server = null;
      server6 = null;
    },
  };
}
