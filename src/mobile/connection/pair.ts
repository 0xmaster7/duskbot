import { MOBILE_LINK_VERSION, parseMobilePairingLink, type MobileCapabilities, type MobileConnectionRecord, type MobilePairingPayload } from "../../../shared/mobile-link";
import type { MobilePlatform } from "../platform";

export type TypedPairing = Omit<MobilePairingPayload, "credential"> & { credential?: string };
type PairErrorCode = "expired" | "used" | "unreachable" | "mismatch" | "refused" | "relay-unavailable" | "invalid";

export class PairError extends Error {
  readonly code: PairErrorCode;
  constructor(code: PairErrorCode) {
    super(`mobile.pair.${code}`);
    this.name = "PairError";
    this.code = code;
  }
}

export function parseTypedPairing(input: string): MobilePairingPayload | null {
  const value = input.trim();
  if (value.startsWith("openmausbot:")) return parseMobilePairingLink(value);
  const match = /^(\S+)\s+([A-Za-z0-9]{12})$/.exec(value);
  if (!match) return null;
  try {
    const origin = new URL(match[1].includes("://") ? match[1] : `https://${match[1]}`);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || match[1].includes("\\")) return null;
    return { v: MOBILE_LINK_VERSION, transport: "https", origin: origin.origin, credential: "", code: match[2].toUpperCase() };
  } catch { return null; }
}

const pendingAttempts = new WeakMap<MobilePlatform, Map<string, Promise<string>>>();

async function attemptId(payload: TypedPairing, platform: MobilePlatform, origin: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload.credential || `${origin}\0${payload.code}`));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 12);
  const key = `omb.mobile.pairAttempt.${hash}`;
  let attempts = pendingAttempts.get(platform);
  if (!attempts) { attempts = new Map(); pendingAttempts.set(platform, attempts); }
  const existing = attempts.get(key);
  if (existing) return existing;
  const request = (async () => {
    const saved = await platform.prefs.get(key);
    if (saved) return saved;
    const id = crypto.randomUUID();
    await platform.prefs.set(key, id);
    return id;
  })().finally(() => attempts.delete(key));
  attempts.set(key, request);
  return request;
}

type PairAnswer = {
  token?: string;
  serverName?: string;
  device?: { id?: string; capabilities?: Partial<MobileCapabilities> };
  environmentId?: string;
  scopes?: string[];
  id?: string;
  capabilities?: Partial<MobileCapabilities>;
  code?: string;
  error?: string;
};

async function answerOf(response: Response): Promise<PairAnswer> {
  const answer: unknown = await response.json().catch(() => null);
  return answer && typeof answer === "object" && !Array.isArray(answer) ? answer as PairAnswer : {};
}

function responseError(status: number, answer: PairAnswer): PairError {
  if (status === 410 || status === 400 && /expired/i.test(`${answer.code ?? ""} ${answer.error ?? ""}`)) return new PairError("expired");
  if (status === 409) return new PairError("used");
  if (status === 401 || status === 403) return new PairError("refused");
  return new PairError(status >= 500 ? "unreachable" : "invalid");
}

export async function redeemPairing(payload: TypedPairing, platform: MobilePlatform): Promise<{ record: MobileConnectionRecord; token: string }> {
  if (payload.transport === "relay") throw new PairError("relay-unavailable");
  let origin: URL;
  try {
    origin = new URL(payload.origin ?? "");
    if (!(["https:", ...(payload.transport === "companion" ? ["http:"] : [])].includes(origin.protocol)) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new PairError("invalid");
  } catch { throw new PairError("invalid"); }
  if (payload.credential ? !/^omb_pair_[A-Za-z0-9_-]{43}$/.test(payload.credential) : !(payload.transport === "companion" ? /^\d{6}$/ : /^[A-Za-z0-9]{12}$/).test(payload.code ?? "")) throw new PairError("invalid");
  if (payload.expiresAt && payload.expiresAt <= Date.now()) throw new PairError("expired");
  try {
    const pairRequestId = await attemptId(payload, platform, origin.origin);
    const response = await fetch(`${origin.origin}/api/pair`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", mode: "cors", redirect: "error",
      body: JSON.stringify({ ...(payload.credential ? { credential: payload.credential } : {}), ...(payload.code ? { code: payload.code } : {}), deviceName: platform.deviceName(), pairRequestId }),
    });
    const paired = await answerOf(response);
    if (response.status !== 200 && response.status !== 201) throw responseError(response.status, paired);
    if (typeof paired.token !== "string" || !paired.token) throw new PairError("invalid");
    const sessionResponse = await fetch(`${origin.origin}/api/auth/session`, {
      headers: { Authorization: `Bearer ${paired.token}` }, credentials: "omit", mode: "cors", redirect: "error",
    });
    const session = await answerOf(sessionResponse);
    const companionRefused = payload.transport === "companion" && [403, 404].includes(sessionResponse.status);
    if (!sessionResponse.ok && !companionRefused) throw responseError(sessionResponse.status, session);
    const identity = companionRefused ? {} : session;
    if (payload.environmentId && typeof identity.environmentId === "string" && payload.environmentId !== identity.environmentId) throw new PairError("mismatch");
    const advertised = { ...paired.device?.capabilities, ...paired.capabilities, ...identity.capabilities };
    const direct = payload.transport === "https";
    const capability = (key: keyof MobileCapabilities) => typeof advertised[key] === "boolean" ? advertised[key] : direct;
    const id = crypto.randomUUID();
    const now = Date.now();
    const record: MobileConnectionRecord = {
      id, environmentId: typeof identity.environmentId === "string" ? identity.environmentId : origin.origin,
      label: payload.name || (typeof paired.serverName === "string" && paired.serverName) || origin.host,
      transport: payload.transport, origin: origin.origin, sessionRef: `token.${id}`,
      ...(typeof identity.id === "string" ? { sessionId: identity.id } : typeof paired.device?.id === "string" ? { sessionId: paired.device.id } : {}),
      capabilities: {
        chat: true, uploads: true, computerView: true,
        computerControl: capability("computerControl"), routines: capability("routines"), notifications: capability("notifications"),
        settingsWrite: Array.isArray(identity.scopes) && identity.scopes.includes("admin"), openOnDesktop: false,
      },
      addedAt: now, lastUsedAt: now,
    };
    return { record, token: paired.token };
  } catch (error) {
    throw error instanceof PairError ? error : new PairError("unreachable");
  }
}
