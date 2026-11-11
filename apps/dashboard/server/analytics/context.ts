import type { IncomingMessage } from "node:http";

/** where an event came from, shared by every event kind; each field is optional and coarse on purpose */
export interface EventContext {
  /** an anonymous visitor id; today a daily hash, so it never links days or leads back to an address */
  visitor?: string;
  /** one visit in the page (random, per tab), or one app session */
  session?: string;
  page?: string;
  referrer?: string;
  channel?: Channel;
  utm?: { source?: string; medium?: string; campaign?: string };
  /** ISO 3166 alpha-2 from Cloudflare's CF-IPCountry, only behind a trusted proxy */
  country?: string;
  device?: "desktop" | "mobile" | "tablet";
  os?: "mac" | "windows" | "linux" | "ios" | "android" | "other";
  browser?: "chrome" | "safari" | "firefox" | "edge" | "other";
  app?: { platform?: string; version?: string };
}
export type Channel = "direct" | "search" | "social" | "ai" | "email" | "referral" | "campaign";

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|brave|kagi|startpage)\./;
const SOCIAL = /(^|\.)(x\.com|t\.co|twitter\.com|facebook\.com|instagram\.com|linkedin\.com|lnkd\.in|reddit\.com|youtube\.com|tiktok\.com|threads\.net|bsky\.app|news\.ycombinator\.com|producthunt\.com|discord\.com)$/;
const AI = /(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|you\.com|phind\.com|poe\.com|grok\.com|meta\.ai|deepseek\.com)$/;
const MAIL = /(^|\.)(mail\.google\.com|outlook\.live\.com|mail\.yahoo\.com)$|^(mail|webmail)\./;

/** a referrer host and campaign as one channel; AI assistants count apart from search */
export function channelOf(referrer: string | undefined, utm: EventContext["utm"]): Channel {
  const medium = utm?.medium?.toLowerCase();
  if (medium === "email" || medium === "newsletter") return "email";
  if (utm?.source && /chatgpt|perplexity|claude|gemini|copilot/.test(utm.source)) return "ai";
  if (utm?.campaign || medium) return "campaign";
  if (!referrer) return utm?.source ? "campaign" : "direct";
  if (AI.test(referrer)) return "ai";
  if (SEARCH.test(referrer)) return "search";
  if (SOCIAL.test(referrer)) return "social";
  if (MAIL.test(referrer)) return "email";
  return "referral";
}

export function deviceOf(ua: string): Pick<EventContext, "device" | "os" | "browser"> {
  const os = /iphone|ipad|ipod/i.test(ua) ? "ios" : /android/i.test(ua) ? "android" : /mac os x|macintosh/i.test(ua) ? "mac" : /windows/i.test(ua) ? "windows" : /linux|cros/i.test(ua) ? "linux" : "other";
  const device = /ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua)) ? "tablet" : /mobi|iphone|ipod/i.test(ua) ? "mobile" : "desktop";
  const browser = /edg\//i.test(ua) ? "edge" : /firefox|fxios/i.test(ua) ? "firefox" : /chrome|crios|chromium/i.test(ua) ? "chrome" : /safari/i.test(ua) ? "safari" : "other";
  return { device, os, browser };
}

const short = (value: string | null | undefined, max = 60) => value ? value.toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, max) || undefined : undefined;

/** what a browser request says about where it came from: device, country (trusted proxy only), referrer, utm */
export function requestContext(req: IncomingMessage, options: { publicOrigin: string; trustProxy: boolean; url?: URL; referrer?: string }): EventContext {
  const ctx: EventContext = { ...deviceOf(String(req.headers["user-agent"] ?? "")) };
  const country = req.headers["cf-ipcountry"];
  if (options.trustProxy && typeof country === "string" && /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1") ctx.country = country;
  try {
    const host = new URL(options.referrer ?? String(req.headers.referer ?? "")).hostname.toLowerCase();
    if (host && host !== new URL(options.publicOrigin).hostname) ctx.referrer = host.slice(0, 80);
  } catch {}
  if (options.url) {
    const utm = { source: short(options.url.searchParams.get("utm_source")), medium: short(options.url.searchParams.get("utm_medium")), campaign: short(options.url.searchParams.get("utm_campaign"), 80) };
    if (!utm.source && options.url.searchParams.get("ref")) utm.source = short(options.url.searchParams.get("ref"));
    if (utm.source || utm.medium || utm.campaign) ctx.utm = Object.fromEntries(Object.entries(utm).filter(([, v]) => v)) as EventContext["utm"];
  }
  ctx.channel = channelOf(ctx.referrer, ctx.utm);
  return ctx;
}
