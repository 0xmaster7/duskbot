// the direct path to a linked vps: one ssh connection to the server's own sshd on port 22, which every vps already
// answers, so no port is opened and no setting is changed. the app's key there is restricted to one forced command,
// `agent.mjs direct`, which speaks the relay's sealed frames on its stdin/stdout: the end-to-end sealing, the replay guard
// and the server identity stay exactly as they are on the relay, and sshd's host key is pinned on top. stun hole punching
// (webrtc) was measured first and fails against a vps whose firewall drops unsolicited udp when the app sits behind a
// symmetric nat (most vpns), while tcp 22 is open on every vps; see link-service/README.md "Direct path".
import { createRequire } from "node:module";
import { connect as netConnect } from "node:net";

import { openFrame, sealBytes, sealFrame } from "./vps-link-protocol.mjs";

// ---- direct transport shared with link-service/agent.mjs (keep both in step; a test checks they interoperate) ----
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


const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000, 60_000];

/**
 * one direct link, kept up in the background: dial, wait for the agent's sealed hello, ping for liveness and rtt, redial
 * with backoff. `connect()` gives { readable, writable, close }. while it is not up, the caller uses the relay.
 */
export function createDirectLink({ id, key: keyText, guard, connect, onFrame, onChange = () => {}, onFailure = () => {}, log = () => {}, pingMs = 5000, helloMs = 20_000 }) {
  const key = Buffer.from(keyText, "base64url");
  let state = "idle", conn = null, writer = null, closed = false, attempt = 0, retryTimer = null, pingTimer = null, helloTimer = null;
  let rtt = null, everUp = false, pingSeq = 0, suspect = false, heardAt = 0;
  const outstanding = new Map();
  const waiters = new Set();
  const set = (next, extra = {}) => { state = next; for (const wake of [...waiters]) wake(); onChange({ state, ...extra }); };
  const ready = () => state === "up" && !suspect;

  function retry() {
    if (closed) return;
    clearTimeout(retryTimer);
    const ms = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    set("waiting");
    retryTimer = setTimeout(() => void dial(), ms);
    retryTimer.unref?.();
  }

  function drop(reason) {
    if (!conn) return;
    const was = state;
    const gone = conn;
    conn = null;
    clearInterval(pingTimer);
    clearTimeout(helloTimer);
    outstanding.clear();
    writer?.close();
    writer = null;
    suspect = false;
    try { gone.close(); } catch { /* already closed */ }
    log(`vps link: direct path ${was === "up" ? "lost" : "failed"} (${reason})`);
    set("down", { lost: was === "up" });
    retry();
  }

  function ping(deadlineMs) {
    if (!writer) return;
    const n = (pingSeq += 1);
    outstanding.set(n, performance.now());
    writer.push({ t: "ping", n });
    const limit = deadlineMs ?? Math.max(4000, (rtt ?? 1000) * 4);
    // a busy link answers late but keeps delivering: only silence means it is gone
    const check = () => {
      if (!outstanding.has(n) || !conn) return;
      if (performance.now() - heardAt >= limit) drop("no answer");
      else setTimeout(check, limit / 2).unref?.();
    };
    setTimeout(check, limit).unref?.();
  }

  async function dial() {
    if (closed || conn || state === "connecting") return;
    clearTimeout(retryTimer);
    set("connecting");
    let link;
    try { link = await connect(); }
    catch (error) {
      if (closed) return;
      log(`vps link: direct path did not connect (${error?.message ?? error})`);
      onFailure(error);
      retry();
      return;
    }
    if (closed) { link.close(); return; }
    conn = link;
    const mine = link;
    writer = createDirectWriter({
      sealFrame: (frame) => sealFrame(key, id, "to-vps", frame, true),
      sealBytes: (r, bytes) => sealBytes(key, id, "to-vps", r, bytes, true),
      write: (record) => conn === mine && link.writable.write(record),
    });
    const read = directReader((type, payload) => {
      if (conn !== mine) return;
      heardAt = performance.now();
      if (type === REC_ACK && payload.length === 4) { writer.acked(payload.readUInt32BE(0)); return; }
      if (type !== REC_SEALED) return;
      let frame = null;
      try { frame = openFrame(key, id, "to-app", payload, guard); } catch { log("vps link: dropped a direct frame that did not open"); }
      if (!frame) return;
      if (frame.t === "hello") {
        clearTimeout(helloTimer);
        attempt = 0;
        everUp = true;
        set("up");
        pingTimer = setInterval(() => ping(), pingMs);
        pingTimer.unref?.();
        ping();
        return;
      }
      if (frame.t === "pong") {
        const sent = outstanding.get(frame.n);
        if (sent !== undefined) {
          outstanding.delete(frame.n);
          rtt = rtt === null ? performance.now() - sent : rtt * 0.7 + (performance.now() - sent) * 0.3;
          if (suspect) { suspect = false; set("up"); }
        }
        return;
      }
      if (state !== "up") return;
      if (frame.t === "bytes") writer.received(frame.b.length);
      onFrame(frame);
    });
    link.readable.on("data", (chunk) => { try { read(chunk); } catch (error) { if (conn === mine) drop(error.message); } });
    link.readable.on("end", () => { if (conn === mine) drop("closed"); });
    link.readable.on("close", () => { if (conn === mine) drop("closed"); });
    link.readable.on("error", (error) => { if (conn === mine) drop(error?.message ?? "error"); });
    link.writable.on("error", (error) => { if (conn === mine) drop(error?.message ?? "error"); });
    link.writable.on("drain", () => { if (conn === mine) writer.drained(); });
    helloTimer = setTimeout(() => { if (conn === mine) drop("no hello"); }, helloMs);
    helloTimer.unref?.();
    link.writable.write(DIRECT_MAGIC);
    writer.push({ t: "hello", v: 1 });
  }

  return {
    start() { if (!closed && state === "idle") void dial(); },
    ready,
    state: () => state,
    rtt: () => rtt,
    everUp: () => everUp,
    /** resolves true once up, false after `ms` or when the link gave up for now */
    whenUp(ms) {
      if (ready()) return Promise.resolve(true);
      return new Promise((resolve) => {
        const timer = setTimeout(() => { waiters.delete(wake); resolve(false); }, ms);
        const wake = () => { if (ready() || state === "waiting" || state === "closed") { clearTimeout(timer); waiters.delete(wake); resolve(ready()); } };
        waiters.add(wake);
      });
    },
    push: (frame) => writer?.push(frame),
    bytes: (r, chunk) => (writer ? writer.bytes(r, chunk) : true),
    onDrain: (resume) => (writer ? writer.onDrain(resume) : resume()),
    discard: (r) => writer?.discard(r),
    /** after a wake or a network change: new requests take the relay until a quick ping proves this connection alive */
    nudge() {
      if (closed) return;
      if (state === "up") { suspect = true; set("up"); ping(Math.max(1500, (rtt ?? 500) * 3)); }
      else if (state === "waiting" || state === "down") { attempt = 0; void dial(); }
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(retryTimer);
      const gone = conn;
      conn = null;
      clearInterval(pingTimer);
      clearTimeout(helloTimer);
      writer?.close();
      try { gone?.close(); } catch { /* already closed */ }
      set("closed");
    },
  };
}

let ssh2 = null;
/** the vendored ssh2 (electron/vendor: the packaged app ships no node_modules), loaded on first use */
export function loadSsh2() {
  ssh2 ??= createRequire(import.meta.url)("./vendor/ssh2.cjs");
  return ssh2;
}

/** a new key for the direct link: { privateKey (openssh), publicKey ("ssh-ed25519 AAAA...") } */
export function newDirectKey() {
  const pair = loadSsh2().utils.generateKeyPairSync("ed25519");
  return { privateKey: pair.private, publicKey: pair.public.trim().split(/\s+/).slice(0, 2).join(" ") };
}

/**
 * dials sshd and opens one channel. only a host key the agent sent inside the sealed tunnel is accepted, so neither the
 * network nor the relay can stand in for the server; the server's forced command ignores what is asked to run.
 */
export function sshConnector({ host, port = 22, user, privateKey, hostKeys, timeoutMs = 20_000 }) {
  const pinned = hostKeys.map((entry) => Buffer.from(String(entry).split(/\s+/)[1] ?? "", "base64")).filter((blob) => blob.length > 0);
  // an rsa host key signs with sha-2 on any recent sshd
  const types = [...new Set(hostKeys.flatMap((entry) => { const type = String(entry).split(/\s+/)[0]; return type === "ssh-rsa" ? ["rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"] : [type]; }))];
  return () => new Promise((resolve, reject) => {
    const { Client } = loadSsh2();
    const client = new Client();
    const sock = netConnect({ host, port });
    sock.setNoDelay(true);
    sock.setKeepAlive(true, 15_000);
    let settled = false, refused = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      client.end();
      sock.destroy();
      reject(refused ? Object.assign(new Error("the server's ssh key is not the one it said"), { code: "HOSTKEY" }) : error);
    };
    // ssh2 can emit more than one error (e.g. a reset then "Connection lost before handshake"): every one must be
    // handled, or an uncaught exception takes down the main process; after settling, the channel's close drops the link
    client.on("error", (error) => fail(error));
    sock.on("error", (error) => fail(error));
    client.once("ready", () => {
      client.exec("omb-direct", (error, channel) => {
        if (error) return fail(error);
        settled = true;
        resolve({ readable: channel, writable: channel, close: () => { channel.destroy?.(); client.end(); sock.destroy(); } });
      });
    });
    client.connect({
      sock, username: user, privateKey, readyTimeout: timeoutMs, keepaliveInterval: 15_000, keepaliveCountMax: 2,
      algorithms: { serverHostKey: types },
      hostVerifier: (presented) => {
        const ok = pinned.some((blob) => blob.equals(presented));
        if (!ok) refused = true;
        return ok;
      },
    });
  });
}
