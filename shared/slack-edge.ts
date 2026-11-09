// The Slack wake edge for sleeping cloud desktops (dashboard/server/slack-edge). While a desktop sleeps, the hosted
// service holds its bots' Socket Mode connections, seals every event to the desktop's own key at once, wakes the
// desktop, and hands the sealed events back when the desktop syncs. Only the desktop can open them.
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";

export const SLACK_EDGE_VERSION = 1 as const;
export const SLACK_EDGE_SYNC_PATH = "/v1/slack-edge/sync";
export const SLACK_EDGE_TOKENS_PATH = "/v1/slack-edge/tokens";
/** a desktop syncs this often while awake, and once at once after it starts */
export const SLACK_EDGE_SYNC_MS = 60_000;

export interface SlackEdgeBot { botId: string; appId: string; botUserId: string; /** sha256 hex of the app-level token, so the edge asks only for a changed one */ tokenHash: string }
export interface SlackEdgeSync {
  v: typeof SLACK_EDGE_VERSION;
  /** x25519 spki der, base64; the desktop keeps the private half */
  publicKey: string;
  bots: SlackEdgeBot[];
  /** sealed events the desktop has handled; the edge deletes them */
  ack: string[];
}
export interface SlackEdgeEvent { id: string; botId: string; receivedAt: number; sealed: string }
export interface SlackEdgeSyncAnswer {
  v: typeof SLACK_EDGE_VERSION;
  /** the owner turned wake for Slack on for this desktop and the service runs the edge */
  enabled: boolean;
  /** bots whose app-level token the edge lacks or holds an older one of */
  needTokens: string[];
  events: SlackEdgeEvent[];
}
export interface SlackEdgeTokens { v: typeof SLACK_EDGE_VERSION; tokens: Array<{ botId: string; appToken: string }> }

export const SLACK_EDGE_LIMITS = { bots: 50, events: 64, sealedBytes: 256 * 1024, eventBytes: 64 * 1024, ttlMs: 24 * 60 * 60_000 } as const;

export const appTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function slackEdgeKeys(): { publicKey: string; privateKey: string } {
  const pair = generateKeyPairSync("x25519");
  return { publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"), privateKey: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64") };
}

export function validEdgePublicKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 200 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    const der = Buffer.from(value, "base64"), key = createPublicKey({ key: der, format: "der", type: "spki" });
    return key.asymmetricKeyType === "x25519" && key.export({ type: "spki", format: "der" }).equals(der);
  } catch { return false; }
}

function sharedKey(secret: Buffer, ephemeral: Buffer, recipient: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.concat([ephemeral, recipient]), "omb-slack-edge-v1", 32));
}
const rawOf = (key: ReturnType<typeof createPublicKey>) => Buffer.from(key.export({ format: "jwk" }).x!, "base64url");

/** x25519 to the desktop's key, hkdf, aes-256-gcm; the bot id is bound in, so an event cannot be moved to another bot */
export function sealForDesktop(publicKey: string, botId: string, plaintext: string): string {
  const recipient = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
  const pair = generateKeyPairSync("x25519"), ephemeral = rawOf(pair.publicKey);
  const key = sharedKey(diffieHellman({ privateKey: pair.privateKey, publicKey: recipient }), ephemeral, rawOf(recipient));
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`omb-slack-edge-v1|${botId}`));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `s1.${Buffer.concat([ephemeral, iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

export function openSealed(privateKey: string, botId: string, sealed: string): string {
  if (!sealed.startsWith("s1.")) throw new Error("Unknown sealed event.");
  const bytes = Buffer.from(sealed.slice(3), "base64url");
  if (bytes.length < 60) throw new Error("Sealed event is too short.");
  const own = createPrivateKey({ key: Buffer.from(privateKey, "base64"), format: "der", type: "pkcs8" });
  const ephemeral = bytes.subarray(0, 32), iv = bytes.subarray(32, 44), tag = bytes.subarray(44, 60);
  const sender = createPublicKey({ key: { kty: "OKP", crv: "X25519", x: ephemeral.toString("base64url") }, format: "jwk" });
  const key = sharedKey(diffieHellman({ privateKey: own, publicKey: sender }), ephemeral, rawOf(createPublicKey(own)));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(`omb-slack-edge-v1|${botId}`));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(bytes.subarray(60)), decipher.final()]).toString("utf8");
}

/** what the edge reads of an event to decide whether it wakes the desktop: the type fields only, never the text */
export function edgeEventKind(payload: Record<string, unknown>, botUserId: string): "wake" | "keep" | "drop" {
  const event = payload.event && typeof payload.event === "object" && !Array.isArray(payload.event) ? payload.event as Record<string, unknown> : null;
  if (payload.type !== "event_callback" || !event) return "drop";
  if (event.bot_id !== undefined || event.user === botUserId) return "drop";
  if (event.type === "app_mention") return "wake";
  if (event.type === "message" && event.channel_type === "im" && (event.subtype === undefined || event.subtype === "file_share")) return "wake";
  if (event.type === "reaction_added") return "keep";
  return "drop";
}
