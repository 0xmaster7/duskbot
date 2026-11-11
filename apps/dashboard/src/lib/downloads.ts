import { useEffect, useState } from "react";
import { SITE_URL, siteUrl } from "./site";

export type Platform = "macos" | "windows" | "linux" | "android" | "ios";
export const PLATFORMS: readonly Platform[] = ["macos", "windows", "linux", "android", "ios"];

export function detectOs(): Platform | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const hinted = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? "";
  const ua = `${hinted} ${navigator.userAgent}`.toLowerCase();
  if (/android/.test(ua)) return "android";
  if (/iphone|ipad|ipod/.test(ua) || (/mac/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/mac/.test(ua)) return "macos";
  if (/win/.test(ua)) return "windows";
  if (/linux|cros/.test(ua)) return "linux";
  return "unknown";
}

export type ReleaseState = "out" | "soon" | "unknown";

let asked: Promise<ReleaseState> | null = null;

// the site marks a release out by publishing releases/latest.json with a version, the same test its own pages use
function askSite(): Promise<ReleaseState> {
  asked ??= fetch(`${SITE_URL}/releases/latest.json`, { cache: "no-store" })
    .then(async (res) => {
      if (res.status === 404) return "soon";
      if (!res.ok) return "unknown";
      const body = (await res.json().catch(() => null)) as { version?: unknown } | null;
      return typeof body?.version === "string" ? "out" : "soon";
    })
    .catch((): ReleaseState => "unknown");
  return asked;
}

export function useReleaseState(): ReleaseState | null {
  const [state, setState] = useState<ReleaseState | null>(null);
  useEffect(() => {
    let alive = true;
    void askSite().then((s) => { if (alive) setState(s); });
    return () => { alive = false; };
  }, []);
  return state;
}

const ANCHOR: Record<Platform, string> = { macos: "mac", windows: "windows", linux: "linux", android: "android", ios: "iphone" };
export const downloadPage = (p: Platform) => siteUrl(`/download#${ANCHOR[p]}`);
export const WAITLIST_URL = siteUrl("/waitlist?source=dashboard");
