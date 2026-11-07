// The mobile app's side of the phone link: what a "Link your phone" QR or
// deep link carries, and what the phone keeps per linked workspace. The server
// and link service own enrollment; this file is the shape both sides agree on.
// Long-lived tokens never appear here: a connection holds a reference into the
// phone's Keychain/Keystore, not the secret.
import { qrEndpoints, type CompanionEndpoint } from "./pairing-link.ts";

export const MOBILE_LINK_VERSION = 1;

/** How the phone reaches a workspace. `https`: its own bearer session on a reachable origin. `relay`: a per-phone channel
 * through the link service for a VPS with no public route. `companion`: the Mac's sidecar with a device token. */
export type MobileTransportKind = "https" | "relay" | "companion";

export interface MobileRelayRoute {
  /** The link service origin, e.g. https://link.apps.siddz.com. */
  service: string;
  /** The per-phone channel id the service issued for this enrollment, never the Mac's tunnel. */
  channel: string;
}

/** A parsed `openmausbot://pair` link or QR. One-time: redeeming `credential` mints the phone's own session. */
export interface MobilePairingPayload {
  v: number;
  transport: MobileTransportKind;
  /** Bare https origin for `https`, the companion base for `companion`; absent for relay-only. */
  origin?: string;
  relay?: MobileRelayRoute;
  /** omb_pair_ + 43 base64url characters. */
  credential: string;
  code?: string;
  /** The workspace's display name. */
  name?: string;
  /** The workspace identity the redeemed session must match; a mismatch refuses the link. */
  environmentId?: string;
  endpoints?: CompanionEndpoint[];
  expiresAt?: number;
}

/** What the phone may do on this connection, from the server's answer, never guessed from the transport. */
export interface MobileCapabilities {
  chat: boolean;
  uploads: boolean;
  computerView: boolean;
  computerControl: boolean;
  routines: boolean;
  settingsWrite: boolean;
  notifications: boolean;
  openOnDesktop: boolean;
}

/** One linked workspace on the phone. */
export interface MobileConnectionRecord {
  id: string;
  environmentId: string;
  label: string;
  transport: MobileTransportKind;
  origin?: string;
  relay?: MobileRelayRoute;
  /** Key of the bearer token in secure storage. */
  sessionRef: string;
  sessionId?: string;
  capabilities: MobileCapabilities;
  /** Server identity pin (SPKI or seal-key id) recorded at pairing. */
  identityPin?: string;
  addedAt: number;
  lastUsedAt: number;
}

/** A place in a workspace, opened by deep link in either direction (phone to desktop, desktop or notification to phone). */
export interface MobileOpenTarget {
  environmentId?: string;
  botId?: string;
  groupId?: string;
  threadId?: string;
  messageId?: string;
  view?: "chat" | "computer" | "profile" | "routines" | "settings" | "notifications";
}

const CREDENTIAL = /^omb_pair_[A-Za-z0-9_-]{43}$/;
const VIEWS = new Set<NonNullable<MobileOpenTarget["view"]>>(["chat", "computer", "profile", "routines", "settings", "notifications"]);

function bareOrigin(value: string | null, protocols: string[]): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `http://${value}`);
    if (!protocols.includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function decodeEndpoints(value: string | null): CompanionEndpoint[] | undefined {
  if (!value) return undefined;
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    const json = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
    const routes = qrEndpoints(JSON.parse(json));
    return routes.length ? routes : undefined;
  } catch {
    return undefined;
  }
}

/** Null when the link is not a pairing link or any required part is malformed. */
export function parseMobilePairingLink(link: string): MobilePairingPayload | null {
  let url: URL;
  try { url = new URL(link.trim()); } catch { return null; }
  if (url.protocol !== "openmausbot:" || (url.hostname || url.pathname.replace(/^\/+/, "")) !== "pair") return null;
  const q = url.searchParams;
  const credential = q.get("token") ?? "";
  if (!CREDENTIAL.test(credential)) return null;
  const code = q.get("code") ?? undefined;
  if (code !== undefined && !/^[A-Za-z0-9]{6,12}$/.test(code)) return null;
  const relayService = bareOrigin(q.get("relay"), ["https:"]);
  const relayChannel = q.get("channel") ?? "";
  const relay = relayService && /^[A-Za-z0-9_-]{8,128}$/.test(relayChannel) ? { service: relayService, channel: relayChannel } : undefined;
  const origin = bareOrigin(q.get("address"), ["https:", "http:"]);
  const endpoints = decodeEndpoints(q.get("endpoints"));
  if (!origin && !relay) return null;
  const transport: MobileTransportKind = relay && !origin ? "relay" : q.get("kind") === "companion" || q.has("code") && !q.has("env") ? "companion" : "https";
  const expires = Number(q.get("exp"));
  const environmentId = q.get("env") ?? undefined;
  return {
    v: Number(q.get("v")) || MOBILE_LINK_VERSION,
    transport,
    ...(origin ? { origin } : {}),
    ...(relay ? { relay } : {}),
    credential,
    ...(code ? { code } : {}),
    ...(q.get("name")?.trim() ? { name: q.get("name")!.trim() } : {}),
    ...(environmentId && /^[A-Za-z0-9_.:-]{1,128}$/.test(environmentId) ? { environmentId } : {}),
    ...(endpoints ? { endpoints } : {}),
    ...(Number.isFinite(expires) && expires > 0 ? { expiresAt: expires } : {}),
  };
}

/** `openmausbot://open?...`: the same shape opens a place on the phone or, sent from the phone, on the desktop. */
export function mobileOpenLink(target: MobileOpenTarget): string {
  const fields: Array<[string, string | undefined]> = [
    ["env", target.environmentId], ["bot", target.botId], ["group", target.groupId],
    ["thread", target.threadId], ["message", target.messageId], ["view", target.view],
  ];
  const query = fields.filter(([, value]) => value).map(([key, value]) => `${key}=${encodeURIComponent(value!)}`).join("&");
  return `openmausbot://open${query ? `?${query}` : ""}`;
}

export function parseMobileOpenLink(link: string): MobileOpenTarget | null {
  let url: URL;
  try { url = new URL(link.trim()); } catch { return null; }
  if (url.protocol !== "openmausbot:" || (url.hostname || url.pathname.replace(/^\/+/, "")) !== "open") return null;
  const q = url.searchParams;
  const id = (key: string) => { const value = q.get(key); return value && /^[A-Za-z0-9_.:-]{1,200}$/.test(value) ? value : undefined; };
  const view = q.get("view") as MobileOpenTarget["view"] | null;
  const target: MobileOpenTarget = {
    environmentId: id("env"), botId: id("bot"), groupId: id("group"), threadId: id("thread"), messageId: id("message"),
    view: view && VIEWS.has(view) ? view : undefined,
  };
  for (const key of Object.keys(target) as (keyof MobileOpenTarget)[]) if (target[key] === undefined) delete target[key];
  return target;
}
