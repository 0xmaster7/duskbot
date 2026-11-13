// the relay's wire contract, shared by the worker and its tests. clients: apps/link-service/agent.mjs (the server end)
// and electron/vps-link-direct.mjs (the app end) derive the same bearer from the tunnel key.
export const TUNNEL_ID = /^[a-z2-7]{10}$/;
export const SESSION_ID = /^[a-z2-7]{12}$/;
export const ACCT = /^[0-9a-f]{32}$/;
export const HEX64 = /^[0-9a-f]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** app sessions one tunnel may hold at once */
export const MAX_SESSIONS = 8;
/** an app session the server has not picked up in this long is closed */
export const PAIR_MS = 15_000;
/** what an app may send before its server's socket is there */
export const PENDING_BYTES = 1024 * 1024;
/** bytes waiting for the fair-use rate in one tunnel; past it the sender's socket is closed */
export const QUEUE_BYTES = 48 * 1024 * 1024;
/**
 * tunnel bytes go to the account's tally once there are REPORT_MIN_BYTES (REPORT_MS later, at once past REPORT_BYTES)
 * and when the last app leaves: pings alone never wake the account's object
 */
export const REPORT_MS = 2000;
export const REPORT_MIN_BYTES = 256 * 1024;
export const REPORT_BYTES = 8 * 1024 * 1024;

/** close codes the relay sends */
export const CLOSE = Object.freeze({ replaced: 4000, reRegistered: 4001, unpaired: 4002, tooFast: 4003, forgotten: 4004, peerGone: 4005 });

export function bearerOf(request) {
  const match = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "");
  return match && TOKEN.test(match[1]) ? match[1] : null;
}

export async function sha256hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sameHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export const randomB32 = (length) => Array.from(crypto.getRandomValues(new Uint8Array(length)), (byte) => B32[byte & 31]).join("");

/** a peer's close code, as one the relay may send on to the other side */
export function forwardCode(code) {
  return code === 1000 || code === 1001 || (code >= 1011 && code <= 1013) || (code >= 3000 && code <= 4999) ? code : 1000;
}

export const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
