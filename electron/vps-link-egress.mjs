// "route traffic through this computer": the linked vps asks this app to open tcp streams for its bot computers'
// browsers, and the bytes ride the sealed tunnel as ordinary stream frames.
//
// Security: only the paired vps can ask (its frames open only with the tunnel key). Whatever it asks, this computer
// connects only to ports 80 and 443 on the public internet: it looks names up itself, refuses the whole name when any
// address is not public (loopback, this computer, its networks, its home's own public address, private, cgnat,
// link-local, metadata, multicast or reserved, after unwrapping nat64 and 6to4), and connects only to the addresses it
// checked, so a name that resolves elsewhere a moment later (dns rebinding) changes nothing. no udp.
import { lookup } from "node:dns/promises";
import { BlockList, connect as tcpConnect, isIP } from "node:net";
import { networkInterfaces } from "node:os";

import { addressClass, listed, ownAddresses, ownSubnets } from "./egress-addresses.mjs";

export const EGRESS_PORTS = Object.freeze([80, 443]);
export const EGRESS_MAX_STREAMS = 128;
export const EGRESS_DIALS_PER_MINUTE = 600;
/** download bytes per second this computer relays for the vps, all streams together */
export const EGRESS_BYTES_PER_SECOND = 8 * 1024 * 1024;
/** the same while a stream rides the relay, under the link service's 6 MiB/s lane limit (apps/link-service/src/app.mjs) */
export const EGRESS_RELAY_BYTES_PER_SECOND = Math.floor(5.5 * 1024 * 1024);
/** a stream's reads pause while this much waits for the tunnel, so the desktop and the api keep their share */
export const EGRESS_QUEUE_HIGH = 1024 * 1024;
export const EGRESS_HELLO_MS = 15_000;
const CONNECT_MS = 10_000;
const IDLE_MS = 5 * 60_000;
const SELF_TTL_MS = 10 * 60_000;
const SELF_WAIT_MS = 3000;
const SELF_RETRY_MS = 30_000;
const LOCAL_SUFFIX = /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|corp|home\.arpa)\.?$/i;
const HOSTNAME = /^(?=.{1,253}\.?$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}\.?$/i;

/** why a name is never looked up here, or null: local names and single labels reach this computer's own network */
export function egressNameRefusal(host) {
  if (typeof host !== "string" || !host || host.length > 255) return "reserved";
  if (isIP(host)) return null;
  if (!HOSTNAME.test(host) || LOCAL_SUFFIX.test(host)) return "home-network";
  return null;
}

/** why this computer will not connect to `port` on these addresses, or null. every address must pass */
export function egressRefusal(port, addresses, { own = new BlockList(), home = new BlockList() } = {}) {
  if (!EGRESS_PORTS.includes(port)) return "port";
  for (const raw of addresses) {
    const kind = addressClass(raw, own);
    if (kind === "metadata" || kind === "link-local" || kind === "reserved" || kind === "loopback") return kind;
    if (kind !== "public" || listed(home, raw)) return "home-network";
  }
  return null;
}

/** this computer's networks and the public address the link service sees it connect from */
export function homeAddresses(interfaces, seenAs) {
  const home = ownSubnets(interfaces);
  if (typeof seenAs === "string" && isIP(seenAs)) home.addAddress(seenAs, isIP(seenAs) === 6 ? "ipv6" : "ipv4");
  return home;
}

const resolveName = (host) => lookup(host, { all: true, verbatim: true }).catch(() => []);

/** `open({ host, port })`: `{ socket }` once connected, `{ refused }` with the reason, or `{ failed }` */
export function createEgressDialer({ resolve = resolveName, connect = tcpConnect, interfaces = networkInterfaces, seenAs = async () => null, connectMs = CONNECT_MS } = {}) {
  return {
    /** asks for the home's public address ahead of the first stream */
    warm() { void seenAs().catch(() => {}); },
    async open({ host, port }) {
      if (!Number.isInteger(port)) return { refused: "reserved" };
      if (!EGRESS_PORTS.includes(port)) return { refused: "port" };
      const named = egressNameRefusal(host);
      if (named) return { refused: named };
      const literal = isIP(host);
      const [addresses, self] = await Promise.all([literal ? [{ address: host, family: literal }] : resolve(host), seenAs()]);
      const now = interfaces();
      const refusal = egressRefusal(port, addresses.map((entry) => entry.address), { own: ownAddresses(now), home: homeAddresses(now, self) });
      if (refusal) return { refused: refusal };
      if (!addresses.length) return { failed: "unreachable" };
      return new Promise((settle) => {
        // the lookup hands back only the checked addresses: either family, never a fresh answer for the name
        const socket = connect({
          host: literal ? host : addresses[0].address, port, autoSelectFamily: true,
          lookup: (_name, options, callback) => options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family),
        });
        const done = (result) => { clearTimeout(timer); socket.off("connect", opened); socket.off("error", failed); settle(result); };
        const opened = () => done({ socket });
        const failed = (error) => { socket.destroy(); done({ failed: error?.code === "ECONNREFUSED" ? "refused" : "unreachable" }); };
        const timer = setTimeout(() => { socket.destroy(); done({ failed: "timeout" }); }, connectMs);
        socket.once("connect", opened);
        socket.once("error", failed);
      });
    },
  };
}

/** the public address `fetchIp()` answers, kept for a while; null when it cannot say */
export function seenAsCache(fetchIp, { ttlMs = SELF_TTL_MS, retryMs = SELF_RETRY_MS, waitMs = SELF_WAIT_MS, now = Date.now, log = () => {} } = {}) {
  let value = null, at = -Infinity, wait = ttlMs, pending = null;
  return async () => {
    if (now() - at < wait) return value;
    // a failed lookup keeps the last address it had and asks again soon
    pending ??= Promise.resolve().then(fetchIp).then((ip) => {
      if (typeof ip !== "string" || !isIP(ip)) throw new Error("no address in the answer");
      value = ip;
      wait = ttlMs;
    }).catch((error) => {
      wait = retryMs;
      log(`egress: the home's public address is unknown (${error?.message ?? error}); asking again in ${Math.round(retryMs / 1000)} s`);
    }).finally(() => { at = now(); pending = null; });
    await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, waitMs).unref?.())]);
    return value;
  };
}

/**
 * this app's end of the egress streams, over any tunnel that carries per-stream frames. `send(frame)` queues a control
 * frame, `bytes(r, chunk)` a stream's bytes, `queued()` how many bytes wait to leave, `onDrain(fn)` calls back once they
 * fell low again: the relay. `direct` is the same api plus `live()` for the direct path. `handle(frame, via)` takes the
 * vps's frames ("relay" or "direct") and answers true for the ones that were egress; a stream answers on the path its
 * dial came by. `onUse()` hears every dial and every piece of a stream, both ways (it keeps this computer awake).
 */
export function createEgressEndpoint({
  send, bytes, queued, onDrain, direct = null, dialer = createEgressDialer(), log = () => {}, now = Date.now, onUse = () => {},
  maxStreams = EGRESS_MAX_STREAMS, dialsPerMinute = EGRESS_DIALS_PER_MINUTE, bytesPerSecond = EGRESS_BYTES_PER_SECOND, relayBytesPerSecond = EGRESS_RELAY_BYTES_PER_SECOND,
  queueHigh = EGRESS_QUEUE_HIGH, helloMs = EGRESS_HELLO_MS, idleMs = IDLE_MS,
}) {
  const relay = { send, bytes, queued, onDrain };
  const streams = new Map();
  const dials = [];
  let budget = bytesPerSecond, relayBudget = relayBytesPerSecond, refilledAt = now(), closed = false, hello = null;
  const stats = { relayed: 0, refused: 0 };

  function take(size, path) {
    const t = now(), seconds = (t - refilledAt) / 1000;
    budget = Math.min(bytesPerSecond, budget + seconds * bytesPerSecond);
    relayBudget = Math.min(relayBytesPerSecond, relayBudget + seconds * relayBytesPerSecond);
    refilledAt = t;
    budget -= size;
    if (path === relay) relayBudget -= size;
    const waitMs = (left, rate) => (left >= 0 ? 0 : Math.ceil((-left / rate) * 1000));
    return Math.max(waitMs(budget, bytesPerSecond), path === relay ? waitMs(relayBudget, relayBytesPerSecond) : 0);
  }

  function forget(r, tell, over = null) {
    const entry = streams.get(r);
    if (!entry) return;
    streams.delete(r);
    clearTimeout(entry.wait);
    entry.socket?.destroy();
    if (tell) (over ?? entry.path).send({ t: "cancel", r });
  }

  function attach(r, socket) {
    const entry = streams.get(r);
    if (!entry || closed) { socket.destroy(); return; }
    entry.socket = socket;
    const { path } = entry;
    socket.setNoDelay(true);
    socket.setTimeout(idleMs, () => forget(r, true));
    const resume = () => { entry.wait = null; if (streams.get(r) === entry && !entry.paused) socket.resume(); };
    socket.on("data", (chunk) => {
      if (streams.get(r) !== entry) return;
      onUse();
      path.bytes(r, chunk);
      const wait = take(chunk.length, path);
      if (path.queued() >= queueHigh) { entry.paused = true; socket.pause(); path.onDrain(() => { entry.paused = false; if (!entry.wait) resume(); }); }
      else if (wait > 0 && !entry.wait) { socket.pause(); entry.wait = setTimeout(resume, wait); }
    });
    socket.on("end", () => { if (streams.get(r) === entry) { entry.endSent = true; path.send({ t: "end", r }); } });
    socket.on("error", () => {});
    // a clean close after its end went out needs no cancel: the vps closes its side when its browser does
    socket.on("close", () => { if (streams.get(r) === entry) forget(r, !entry.endSent); });
    for (const chunk of entry.early) socket.write(chunk);
    entry.early = [];
    if (entry.peerEnded) socket.end();
  }

  async function dial(frame, via) {
    const { r, host, port } = frame;
    const path = via === "direct" && direct?.live() ? direct : relay;
    const refuse = (code) => { stats.refused += 1; path.send({ t: "dialed", r, ok: false, code }); };
    if (typeof r !== "string" || !/^[a-z2-7]{12}$/.test(r) || streams.has(r)) return;
    const t = now();
    while (dials.length && t - dials[0] > 60_000) dials.shift();
    if (closed) return refuse("closed");
    if (streams.size >= maxStreams || dials.length >= dialsPerMinute) return refuse("busy");
    dials.push(t);
    onUse();
    streams.set(r, { socket: null, path, early: [], peerEnded: false, endSent: false, paused: false, wait: null });
    let result;
    try { result = await dialer.open({ host, port: Number(port) }); }
    catch (error) { log(`egress: dial failed (${error?.message ?? error})`); result = { failed: "unreachable" }; }
    if (!streams.has(r) || closed) { result.socket?.destroy(); return; }
    if (!result.socket) {
      streams.delete(r);
      return refuse(result.refused ?? result.failed ?? "unreachable");
    }
    stats.relayed += 1;
    path.send({ t: "dialed", r, ok: true });
    attach(r, result.socket);
  }

  return {
    stats: () => ({ ...stats, active: streams.size }),
    /** tells the vps this computer takes streams now and every `helloMs` while it does */
    start() {
      if (hello || closed) return;
      dialer.warm?.();
      const say = () => {
        const hello = { t: "egress", v: 1, ready: true, max: maxStreams };
        send(hello);
        if (direct?.live()) direct.send(hello);
      };
      say();
      hello = setInterval(say, helloMs);
      hello.unref?.();
    },
    handle(frame, via = "relay") {
      if (frame?.t === "dial") { void dial(frame, via); return true; }
      const entry = typeof frame?.r === "string" ? streams.get(frame.r) : undefined;
      if (!entry) return false;
      if (frame.t === "bytes") {
        onUse();
        if (!entry.socket) entry.early.push(frame.b);
        else if (entry.socket.writableLength + frame.b.length > 8 * 1024 * 1024) forget(frame.r, true);
        else entry.socket.write(frame.b);
      } else if (frame.t === "end") {
        entry.peerEnded = true;
        entry.socket?.end();
      } else if (frame.t === "cancel") forget(frame.r, false);
      else return false;
      return true;
    },
    /** the direct path went away: its streams are gone on the vps too, and it hears so over the relay as well */
    pathLost(name) {
      if (name !== "direct" || !direct) return;
      for (const [r, entry] of Array.from(streams)) if (entry.path === direct) forget(r, true, relay);
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(hello);
      const goodbye = { t: "egress", v: 1, ready: false };
      send(goodbye);
      if (direct?.live()) direct.send(goodbye);
      for (const r of streams.keys()) forget(r, false);
    },
  };
}
