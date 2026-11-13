// turn for the webrtc path: short-lived credentials in the turn rest api shape (coturn `use-auth-secret`, eturnal
// `secret`), and a stun binding check of the node's own turn server for the ops page.
import { createHmac, randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";

/** a credential lives this long; the client asks again before it runs out */
export const TURN_TTL_S = 3600;
export const STUN_PUBLIC = Object.freeze(["stun:stun.cloudflare.com:3478"]);

/**
 * the turn rest api: username `<unix expiry>:<label>`, password base64(hmac-sha1(secret, username)). every node's
 * turn server shares the secret, so one credential works on any of them.
 */
export function turnCredential(secret, label, nowMs = Date.now(), ttlS = TURN_TTL_S) {
  const expires = Math.floor(nowMs / 1000) + ttlS;
  const username = `${expires}:${label}`;
  return { username, credential: createHmac("sha1", secret).update(username).digest("base64"), ttl: ttlS, expiresAt: expires * 1000 };
}

/** the urls a node's turn server answers on: udp and tcp on 3478, tls on 5349 when it has a certificate */
export function turnUrls(host, { tls = false } = {}) {
  return [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`, ...(tls ? [`turns:${host}:5349?transport=tcp`] : [])];
}

/** one stun binding request; resolves the round trip in ms, or null when nothing (valid) came back in time */
export function stunPing({ host = "127.0.0.1", port = 3478, timeoutMs = 2000 } = {}) {
  return new Promise((resolve) => {
    const socket = createSocket(host.includes(":") ? "udp6" : "udp4");
    const id = randomBytes(12), started = performance.now();
    let done = false;
    const finish = (value) => { if (done) return; done = true; clearTimeout(timer); try { socket.close(); } catch {} resolve(value); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.on("error", () => finish(null));
    socket.on("message", (msg) => {
      // a binding success (0x0101) carrying our transaction id
      if (msg.length >= 20 && msg.readUInt16BE(0) === 0x0101 && msg.readUInt32BE(4) === 0x2112a442 && msg.subarray(8, 20).equals(id)) finish(Math.round(performance.now() - started));
    });
    const request = Buffer.alloc(20);
    request.writeUInt16BE(0x0001, 0);
    request.writeUInt16BE(0, 2);
    request.writeUInt32BE(0x2112a442, 4);
    id.copy(request, 8);
    socket.send(request, port, host, (error) => { if (error) finish(null); });
  });
}

/** checks the node's turn server every `everyMs`; `state()` is what the ops page shows */
export function createTurnWatch({ host = "127.0.0.1", port = 3478, everyMs = 30_000, ping = stunPing, now = Date.now } = {}) {
  const state = { ok: null, at: null, rttMs: null, downSince: null };
  let timer = null;
  async function check() {
    const rtt = await ping({ host, port });
    const t = now();
    state.at = t; state.rttMs = rtt; state.ok = rtt !== null;
    state.downSince = rtt === null ? state.downSince ?? t : null;
    return state.ok;
  }
  return {
    check,
    start() { if (timer) return; void check(); timer = setInterval(() => void check(), everyMs); timer.unref?.(); },
    stop() { clearInterval(timer); timer = null; },
    state: () => ({ ...state }),
  };
}
