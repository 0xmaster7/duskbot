import { independentScreenExecArgs, type IndependentScreenTarget } from "./shared-desktop-screens.ts";
import type { ViewerLink } from "./vps-local.ts";

export const REMOTE_VIEWER_GRACE_MS = 30_000;
export const NATIVE_VIEWER_LIFETIME_MS = 8 * 60 * 60_000;
export const desktopTunnels = new Map<
  string,
  { link: ViewerLink; joinUrl: string; identity: string; expiry: ReturnType<typeof setTimeout>; viewers: number; localViewer: boolean }
>();


export const boxChromes = new Map<string, { alias: string; containerId: string; url: string; close: () => void }>();
export function evictVpsBoxChrome(key: string, url: string): void {
  const cached = boxChromes.get(key);
  if (cached?.url !== url) return;
  boxChromes.delete(key);
  cached.close();
}

export interface VpsScreenConnection { containerId: string; target: IndependentScreenTarget; live?: () => boolean }
const retiredScreenConnections = new Set<string>();
export function requireLiveScreen(botId: string, screen?: VpsScreenConnection): void {
  if (screen && (retiredScreenConnections.has(screenKey(botId, screen)) || screen.live?.() === false)) throw Object.assign(new Error("This independent screen was reassigned"), { status: 409 });
}

export function closeVpsScreenConnections(botId: string, screen: VpsScreenConnection): void {
  const key = screenKey(botId, screen);
  retiredScreenConnections.add(key);
  stopDesktopTunnel(key);
  boxChromes.get(key)?.close(); boxChromes.delete(key);
}

export function screenKey(botId: string, screen?: VpsScreenConnection): string {
  if (!screen) return botId;
  independentScreenExecArgs(screen.containerId, "ensure", screen.target);
  return `${botId}:screen:${screen.target.botId}:${screen.target.generation}`;
}


export function stopDesktopTunnel(botId: string): boolean {
  const tunnel = desktopTunnels.get(botId);
  if (!tunnel) return false;
  desktopTunnels.delete(botId);
  clearTimeout(tunnel.expiry);
  tunnel.link.stop();
  return true;
}

export function closeVpsDesktopTunnel(botId: string, screen?: VpsScreenConnection) {
  botId = screenKey(botId, screen);
  const tunnel = desktopTunnels.get(botId);
  if (tunnel?.viewers) {
    tunnel.localViewer = false;
    clearTimeout(tunnel.expiry);
    return { closed: false };
  }
  return { closed: stopDesktopTunnel(botId) };
}

export function closeAllVpsDesktopTunnels(): void {
  for (const botId of desktopTunnels.keys()) stopDesktopTunnel(botId);
}

export function vpsDesktopConnection(botId: string, screen?: VpsScreenConnection) {
  requireLiveScreen(botId, screen);
  botId = screenKey(botId, screen);
  const tunnel = desktopTunnels.get(botId);
  if (!tunnel || !tunnel.link.alive()) return;
  const url = new URL(tunnel.joinUrl);
  return {
    port: Number(url.port),
    password: new URLSearchParams(url.hash.slice(1)).get("password"),
    live: () => desktopTunnels.get(botId) === tunnel && tunnel.link.alive(),
    retain: () => {
      tunnel.viewers++;
      if (!tunnel.localViewer) clearTimeout(tunnel.expiry);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        tunnel.viewers--;
        if (!tunnel.viewers && !tunnel.localViewer && desktopTunnels.get(botId) === tunnel) {
          tunnel.expiry = setTimeout(() => {
            if (desktopTunnels.get(botId) === tunnel) stopDesktopTunnel(botId);
          }, REMOTE_VIEWER_GRACE_MS);
          tunnel.expiry.unref();
        }
      };
    },
  };
}
