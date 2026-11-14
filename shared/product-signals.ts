// the named product signals beyond bot turns: what each may carry, key by key. Security: every value is a word from a
// fixed list, a short code-defined name, a count or a flag; a signal with any other key or value is dropped whole, so
// text a person typed, file names, urls and ids can never pass.
import { USAGE_ENGINES, USAGE_REASONS } from "./usage-signals.ts";

type Check = (value: unknown) => boolean;
const oneOf = (...values: readonly string[]): Check => value => typeof value === "string" && values.includes(value);
const between = (min: number, max: number): Check => value => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
/** a name the code defines (a config field, a skin id with "_" for "-"): never anything a person types */
const codeName: Check = value => typeof value === "string" && /^[a-z][a-zA-Z0-9_]{0,31}$/.test(value);

/** the app's languages, with "_" for "-" so they pass as app event words */
export const LOCALES = ["en", "de", "es", "fr", "hi", "ja", "pt_br", "zh", "zh_tw", "uk", "vi", "tr", "pl", "ru", "it", "ko", "other"] as const;
export const ATTACHMENT_KINDS = ["image", "pdf", "doc", "sheet", "slides", "text", "audio", "video", "archive", "other"] as const;
export const SIZE_BUCKETS = ["lt100k", "lt1m", "lt10m", "gte10m"] as const;
export const SCREEN_BUCKETS = ["xs", "s", "m", "l", "xl"] as const;

/** the in-app account sign-in funnel's steps, how a person signed in, and why an attempt failed (a fixed code, never an
 * email, a token or a message) */
export const ACCOUNT_SIGN_IN_STEPS = ["shown", "method", "handoff", "returned", "cancelled", "skipped", "error"] as const;
export const ACCOUNT_SIGN_IN_METHODS = ["google", "x", "apple", "email"] as const;
export const ACCOUNT_SIGN_IN_ERRORS = ["invalid_email", "rate_limited", "failed", "wrong_code", "expired", "signup_closed", "device_limit", "sso", "two_factor",
  "browser", "storage", "other"] as const;

/** where a signal may come from: the apps (as an app_action) or the workspace (in its usage report) */
export const SIGNALS = {
  /** once per app start: the setup a person runs dusk bot in, and the local hour; at most 8 keys, the app action limit */
  env: { source: "app", props: { os: oneOf("darwin", "win32", "linux", "ios", "android", "other"), arch: oneOf("x64", "arm64", "other"), locale: oneOf(...LOCALES),
    screen: oneOf(...SCREEN_BUCKETS), theme: oneOf("light", "dark"), skin: codeName, notifications: oneOf("granted", "denied", "default", "unsupported"), hour: between(0, 23) } },
  /** a step of the first run's dusk bot account sign-in: via is the browser handoff, an emailed code or a magic link */
  account_sign_in: { source: "app", props: { step: oneOf(...ACCOUNT_SIGN_IN_STEPS), method: oneOf(...ACCOUNT_SIGN_IN_METHODS), via: oneOf("browser", "code", "link"),
    code: oneOf(...ACCOUNT_SIGN_IN_ERRORS) } },
  /** an AI sign-in started, finished or failed, by engine family */
  engine_sign_in: { source: "workspace", props: { engine: oneOf(...USAGE_ENGINES), outcome: oneOf("started", "succeeded", "failed", "expired", "cancelled"), reason: oneOf(...USAGE_REASONS) } },
  /** a file attached to a chat: its kind and size bucket, never its name */
  attachment: { source: "workspace", props: { kind: oneOf(...ATTACHMENT_KINDS), size: oneOf(...SIZE_BUCKETS) } },
  /** which setting changed: the config field's name, never its value */
  setting_changed: { source: "workspace", props: { key: codeName } },
  chat_deleted: { source: "workspace", props: {} },
} as const satisfies Record<string, { source: "app" | "workspace"; props: Record<string, Check> }>;
export type SignalName = keyof typeof SIGNALS;
export type SignalProps = Record<string, string | number | boolean>;
export const isSignalName = (value: unknown): value is SignalName => typeof value === "string" && Object.hasOwn(SIGNALS, value);

/** a signal's props exactly as allowed, or null when any key or value is not; an app action's own `name` stays out */
export function cleanSignal(name: unknown, props: unknown, source?: "app" | "workspace"): SignalProps | null {
  if (!isSignalName(name) || (source && SIGNALS[name].source !== source) || !props || typeof props !== "object" || Array.isArray(props)) return null;
  const allowed: Record<string, Check> = SIGNALS[name].props, out: SignalProps = {};
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (key === "name" && value === name) continue;
    const check = allowed[key];
    if (!check || !check(value)) return null;
    out[key] = value as string | number;
  }
  return out;
}

export const sizeBucket = (bytes: number): (typeof SIZE_BUCKETS)[number] => bytes < 100_000 ? "lt100k" : bytes < 1_000_000 ? "lt1m" : bytes < 10_000_000 ? "lt10m" : "gte10m";
export const screenBucket = (width: number): (typeof SCREEN_BUCKETS)[number] => width < 480 ? "xs" : width < 900 ? "s" : width < 1400 ? "m" : width < 2000 ? "l" : "xl";
export function attachmentKind(mime: string): (typeof ATTACHMENT_KINDS)[number] {
  const type = mime.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  if (/wordprocessingml|msword|opendocument\.text|rtf/.test(type)) return "doc";
  if (/spreadsheetml|ms-excel|opendocument\.spreadsheet|text\/csv/.test(type)) return "sheet";
  if (/presentationml|ms-powerpoint|opendocument\.presentation/.test(type)) return "slides";
  if (type.startsWith("text/") || type === "application/json") return "text";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (/zip|tar|gzip|7z|rar/.test(type)) return "archive";
  return "other";
}
export const localeOf = (tag: string): (typeof LOCALES)[number] => {
  const lower = tag.toLowerCase();
  const exact = LOCALES.find(locale => locale === lower);
  if (exact) return exact;
  if (lower.startsWith("pt")) return "pt_br";
  if (lower === "zh-hant" || lower.startsWith("zh-tw") || lower.startsWith("zh-hk") || lower === "zh_tw") return "zh_tw";
  return LOCALES.find(locale => locale === lower.split("-")[0]) ?? "other";
};
