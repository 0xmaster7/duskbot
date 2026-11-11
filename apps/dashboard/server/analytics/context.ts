import type { IncomingMessage } from "node:http";
import { fromCloudflare } from "../client-ip.ts";
import { classify, type Channel } from "./sources.ts";

/** where an event came from, shared by every event kind; each field is optional and coarse on purpose */
export interface EventContext {
  /** the site's anonymous visitor id (the dusk_vid cookie), or a daily hash where no cookie exists */
  visitor?: string;
  /** one site visit (dusk_sid, 30 minutes idle), one tab of the account page, or one app session */
  session?: string;
  /** one page view, so its end (site_leave) can be matched to it */
  pv?: string;
  /** an app install's anonymous id, kept until and after sign-in */
  install?: string;
  host?: string;
  page?: string;
  /** the referring host, never its path or query */
  referrer?: string;
  /** the named source ("ChatGPT", "Hacker News", a ?ref tag) and its channel */
  source?: string;
  channel?: Channel;
  utm?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
  ref?: string;
  /** from Cloudflare's visitor location headers, only when the request came through Cloudflare; coordinates rounded to
   *  about 10 km */
  country?: string;
  region?: string;
  city?: string;
  lat?: number;
  lon?: number;
  device?: "desktop" | "mobile" | "tablet";
  os?: "mac" | "windows" | "linux" | "ios" | "android" | "other";
  browser?: "chrome" | "safari" | "firefox" | "edge" | "other";
  width?: number;
  app?: { platform?: string; version?: string };
}

export function deviceOf(ua: string): Pick<EventContext, "device" | "os" | "browser"> {
  const os = /iphone|ipad|ipod/i.test(ua) ? "ios" : /android/i.test(ua) ? "android" : /mac os x|macintosh/i.test(ua) ? "mac" : /windows/i.test(ua) ? "windows" : /linux|cros/i.test(ua) ? "linux" : "other";
  const device = /ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua)) ? "tablet" : /mobi|iphone|ipod/i.test(ua) ? "mobile" : "desktop";
  const browser = /edg\//i.test(ua) ? "edge" : /firefox|fxios/i.test(ua) ? "firefox" : /chrome|crios|chromium/i.test(ua) ? "chrome" : /safari/i.test(ua) ? "safari" : "other";
  return { device, os, browser };
}

const short = (value: unknown, max = 60) => typeof value === "string" && !value.includes("@") ? value.toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, max) || undefined : undefined;
const label = (value: unknown, max = 60) => {
  if (typeof value !== "string") return undefined;
  let text = value;
  try { text = decodeURIComponent(value); } catch {}
  text = text.replace(/[\u0000-\u001f<>"]/g, "").trim().slice(0, max);
  return text || undefined;
};

/** true when nginx says its peer was Cloudflare's edge, so the CF-* visitor headers were set by Cloudflare */
export function viaCloudflare(req: IncomingMessage, trustProxy: boolean): boolean {
  const forwarded = req.headers["x-forwarded-for"];
  return trustProxy && typeof forwarded === "string" && fromCloudflare(forwarded.split(",").pop()!.trim());
}

export function geoOf(req: IncomingMessage, trustProxy: boolean): Pick<EventContext, "country" | "region" | "city" | "lat" | "lon"> {
  if (!viaCloudflare(req, trustProxy)) return {};
  const out: Pick<EventContext, "country" | "region" | "city" | "lat" | "lon"> = {};
  const country = req.headers["cf-ipcountry"];
  if (typeof country === "string" && /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1") out.country = country;
  const region = label(req.headers["cf-region"]), city = label(req.headers["cf-ipcity"]);
  if (region) out.region = region;
  if (city) out.city = city;
  const lat = Number(req.headers["cf-iplatitude"]), lon = Number(req.headers["cf-iplongitude"]);
  if (req.headers["cf-iplatitude"] !== undefined && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    out.lat = Math.round(lat * 10) / 10; out.lon = Math.round(lon * 10) / 10;
  }
  return out;
}

/** a referrer (a full address or a bare host) as its host, unless it is this host */
export function referrerHost(value: unknown, own: string | null): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  let host: string;
  try { host = (value.includes("/") ? new URL(value).hostname : value).toLowerCase(); } catch { return undefined; }
  if (!/^[a-z0-9.-]{1,253}$/.test(host) || host === own) return undefined;
  return host.slice(0, 80);
}

export interface Touch { referrer?: string; utmSource?: unknown; utmMedium?: unknown; utmCampaign?: unknown; utmContent?: unknown; utmTerm?: unknown; ref?: unknown }
/** a visit's attribution: utm and ref tags win over the referrer */
export function touchContext(touch: Touch): Pick<EventContext, "referrer" | "utm" | "ref" | "source" | "channel"> {
  const utm = { source: short(touch.utmSource), medium: short(touch.utmMedium), campaign: short(touch.utmCampaign, 80), content: short(touch.utmContent, 80), term: short(touch.utmTerm, 80) };
  const ref = short(touch.ref);
  const kept = Object.fromEntries(Object.entries(utm).filter(([, v]) => v)) as EventContext["utm"];
  const { source, channel } = classify({ referrer: touch.referrer ?? null, utmSource: utm.source ?? null, utmMedium: utm.medium ?? null, ref: ref ?? null });
  return { ...(touch.referrer ? { referrer: touch.referrer } : {}), ...(kept && Object.keys(kept).length ? { utm: kept } : {}), ...(ref ? { ref } : {}), source, channel };
}

/** what a browser request says about where it came from: device, Cloudflare geo, referrer and tags */
export function requestContext(req: IncomingMessage, options: { publicOrigin: string; trustProxy: boolean; url?: URL; referrer?: string }): EventContext {
  const own = (() => { try { return new URL(options.publicOrigin).hostname; } catch { return null; } })();
  const params = options.url?.searchParams;
  return {
    ...deviceOf(String(req.headers["user-agent"] ?? "")),
    ...geoOf(req, options.trustProxy),
    ...touchContext({ referrer: referrerHost(options.referrer ?? req.headers.referer, own), utmSource: params?.get("utm_source"), utmMedium: params?.get("utm_medium"),
      utmCampaign: params?.get("utm_campaign"), utmContent: params?.get("utm_content"), utmTerm: params?.get("utm_term"), ref: params?.get("ref") ?? params?.get("via") }),
  };
}
