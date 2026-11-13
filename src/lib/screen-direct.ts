// The app's end of the direct screen path (shared/screen-direct.ts): one WebRTC data channel to the server, signalled
// over the signed-in link, handed to noVNC in place of the relay's WebSocket. Any failure returns a reason instead of
// throwing, and the caller opens the relay as before; nothing is shown to the person.
import {
  SCREEN_CHANNEL, SCREEN_DIRECT_CONNECT_MS, SCREEN_DIRECT_GATHER_MS, SCREEN_DIRECT_ICE_SERVERS, SCREEN_DIRECT_RETRY_MS, SCREEN_ICE_PATH,
  type ScreenFallbackReason,
} from "../../shared/screen-direct";

export type DirectScreen = { channel: RTCDataChannel; close(): void } | { fallback: ScreenFallbackReason };

/** After a failure the next screens go straight to the relay for a while, so a network that cannot punch pays once. */
let blocked: { until: number } | null = null;

/** Forgets an earlier failure (tests, and a changed network). */
export function resetDirectScreen(): void { blocked = null; }

/** TURN servers from the app's own link proxy (only a linked server's page is served there). */
export async function linkProxyTurn(fetcher: typeof fetch = fetch): Promise<RTCIceServer[]> {
  const answer = await fetcher(SCREEN_ICE_PATH, { cache: "no-store", credentials: "same-origin" });
  const body = await answer.json() as { iceServers?: unknown };
  return Array.isArray(body.iceServers) ? body.iceServers.filter((one): one is RTCIceServer => Boolean(one) && typeof one === "object" && "urls" in one).slice(0, 4) : [];
}

/** The page is a linked server's, served through the app's link proxy (`vps-<id>.localhost`). */
export const onLinkProxy = (hostname: string) => /^vps-[\w-]+\.localhost$/.test(hostname);

/** A screen for a server on another machine: the app's own server never needs a direct path. */
export function directScreenWanted(hostname: string): boolean {
  return !["localhost", "127.0.0.1", "[::1]", "::1", ""].includes(hostname);
}

/**
 * Opens the "screen" data channel to the server at `url` (`/api/desktop-viewer/<target>/direct?...`), or says why not.
 * Resolves once the channel is open, within about SCREEN_DIRECT_GATHER_MS + one request + SCREEN_DIRECT_CONNECT_MS.
 */
export async function openDirectScreen(url: string, options: {
  signal: AbortSignal;
  fetch?: typeof fetch;
  RTCPeerConnection?: typeof RTCPeerConnection;
  now?: () => number;
  connectMs?: number;
  /** STUN for both sides (tests pass none). */
  iceServers?: readonly string[];
  /** TURN servers from the signed-in account, when the app has them; a slow or failed answer just means none. */
  turn?: () => Promise<RTCIceServer[]>;
}): Promise<DirectScreen> {
  const now = options.now ?? Date.now;
  const Peer = options.RTCPeerConnection ?? (typeof RTCPeerConnection === "function" ? RTCPeerConnection : undefined);
  if (!Peer) return { fallback: "unsupported" };
  if (blocked && now() < blocked.until) return { fallback: "recent-failure" };
  let pc: RTCPeerConnection;
  const stun = options.iceServers ?? SCREEN_DIRECT_ICE_SERVERS;
  const turn = options.turn ? await Promise.race([options.turn().catch(() => []), new Promise<RTCIceServer[]>((resolve) => setTimeout(() => resolve([]), 1_500))]) : [];
  options.signal.throwIfAborted();
  try { pc = new Peer({ iceServers: [...(stun.length ? [{ urls: [...stun] }] : []), ...turn] }); }
  catch { return { fallback: "unsupported" }; }
  const remember = (fallback: ScreenFallbackReason): DirectScreen => {
    pc.close();
    if (fallback !== "signal-failed") blocked = { until: now() + SCREEN_DIRECT_RETRY_MS };
    return { fallback };
  };
  const abort = () => pc.close();
  options.signal.addEventListener("abort", abort, { once: true });
  try {
    const channel = pc.createDataChannel(SCREEN_CHANNEL, { ordered: true });
    channel.binaryType = "arraybuffer";
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc, SCREEN_DIRECT_GATHER_MS);
    options.signal.throwIfAborted();
    const offer = pc.localDescription;
    if (!offer) return remember("unsupported");
    let answered: Response;
    try {
      answered = await (options.fetch ?? fetch)(url, {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", cache: "no-store",
        body: JSON.stringify({ type: offer.type, sdp: offer.sdp }), signal: options.signal,
      });
    } catch {
      options.signal.throwIfAborted();
      return remember("signal-failed");
    }
    const body = await answered.json().catch(() => null) as { type?: unknown; sdp?: unknown; reason?: unknown } | null;
    if (!answered.ok || body?.type !== "answer" || typeof body.sdp !== "string") {
      return remember(body?.reason === "server-off" || body?.reason === "unsupported" ? body.reason : "signal-failed");
    }
    await pc.setRemoteDescription({ type: "answer", sdp: body.sdp });
    const outcome = await opened(pc, channel, options.connectMs ?? SCREEN_DIRECT_CONNECT_MS, options.signal);
    options.signal.throwIfAborted();
    if (outcome !== "open") return remember(outcome);
    // a path that drops later ends the screen like a dropped socket; the reconnect goes over the relay
    const dropped = () => {
      if (pc.connectionState !== "failed" && pc.connectionState !== "closed") return;
      blocked = { until: now() + SCREEN_DIRECT_RETRY_MS };
      channel.close();
    };
    pc.addEventListener("connectionstatechange", dropped);
    channel.addEventListener("close", () => pc.close(), { once: true });
    return { channel, close: () => pc.close() };
  } catch {
    pc.close();
    options.signal.throwIfAborted();
    return remember("signal-failed");
  } finally {
    options.signal.removeEventListener("abort", abort);
  }
}

function gathered(pc: RTCPeerConnection, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") { resolve(); return; }
    const done = () => {
      if (pc.iceGatheringState !== "complete") return;
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", done);
      resolve();
    };
    const timer = setTimeout(() => { pc.removeEventListener("icegatheringstatechange", done); resolve(); }, ms);
    pc.addEventListener("icegatheringstatechange", done);
  });
}

function opened(pc: RTCPeerConnection, channel: RTCDataChannel, ms: number, signal: AbortSignal): Promise<"open" | "ice-failed" | "timeout"> {
  return new Promise((resolve) => {
    const finish = (outcome: "open" | "ice-failed" | "timeout") => {
      clearTimeout(timer);
      channel.removeEventListener("open", open);
      pc.removeEventListener("connectionstatechange", state);
      signal.removeEventListener("abort", aborted);
      resolve(outcome);
    };
    const open = () => finish("open");
    const state = () => { if (pc.connectionState === "failed" || pc.connectionState === "closed") finish("ice-failed"); };
    const aborted = () => finish("timeout");
    const timer = setTimeout(() => finish("timeout"), ms);
    if (channel.readyState === "open") { finish("open"); return; }
    channel.addEventListener("open", open);
    pc.addEventListener("connectionstatechange", state);
    signal.addEventListener("abort", aborted, { once: true });
  });
}
