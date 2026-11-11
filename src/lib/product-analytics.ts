export const APP_FEATURES = ["bot_created", "bot_edited", "routine_created", "routine_ran", "room_created", "computer_used", "voice_used", "file_uploaded", "app_connected", "cloud_opened", "chat_opened", "memory_edited", "skill_added", "webhook_created", "phone_paired", "search_used", "settings_opened"] as const;
type Feature = typeof APP_FEATURES[number];
type Platform = "darwin" | "win32" | "linux" | "ios" | "android";
type Options = { origin: string | null; token: string | null; platform: Platform; version: string; kind: "desktop" | "mobile"; force?: boolean };
type Props = Record<string, string | number>;
type Event = { name: string; at: number; props: Props };
type Pending = { event: Event; retried: boolean };
const ID = /^[A-Za-z0-9_-]{16,40}$/;
const WORD = /^[a-z0-9_]{1,40}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;
const PLATFORMS: readonly string[] = ["darwin", "win32", "linux", "ios", "android"];
const started = Date.now();
let options: Options | null = null;
let forced = false;
let optedOut = false;
let opened = false;
let closed = false;
let listening = false;
let install = "";
let session = "";
let lastScreen = "";
let queue: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let sent = 0;
let replies = 0;
let latencies: number[] = [];
let revision = 0;
const sends = new Map<string, { at: number; message?: string }>();
const firstReplies = new Map<string, number>();
const routineRuns = new Set<string>();

function clear(): void {
  queue = [];
  sent = replies = 0;
  latencies = [];
  sends.clear();
  firstReplies.clear();
  routineRuns.clear();
  lastScreen = "";
  clearTimeout(timer);
  timer = undefined;
  ++revision;
}

export function usageAnalyticsEnabled(): boolean {
  try { optedOut = localStorage.getItem("dusk-usage-analytics") === "off"; } catch {}
  const enabled = !optedOut && (import.meta.env?.MODE !== "test" || forced);
  if (!enabled) clear();
  return enabled;
}

export function setUsageAnalytics(enabled: boolean): void {
  optedOut = !enabled;
  try { localStorage.setItem("dusk-usage-analytics", enabled ? "on" : "off"); } catch {}
  if (!enabled) clear();
}

function randomId(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function identity(): void {
  if (!install) {
    try { install = localStorage.getItem("dusk-install-id") ?? ""; } catch {}
    if (!ID.test(install)) {
      install = randomId();
      try { localStorage.setItem("dusk-install-id", install); } catch {}
    }
  }
  session ||= randomId();
}

function schedule(): void {
  if (!queue.length && !sent && !replies) { clearTimeout(timer); timer = undefined; return; }
  if (timer) return;
  timer = setTimeout(() => { timer = undefined; void flush(); }, 30_000);
}

function route(path: string): string | null {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return null;
  try {
    const clean = decodeURIComponent(path.split(/[?#]/)[0]).toLowerCase().replace(/\/+$/, "") || "/";
    const folded = clean.split("/").map(part => /\d/.test(part) || part.length > 24 || /^(?:ws_|acct_|bot_)/.test(part) || /^c[0-9a-f]+$/.test(part) ? ":id" : part).join("/");
    return /^\/[a-z0-9/:_-]{0,119}$/.test(folded) ? folded : null;
  } catch { return null; }
}

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < 1e12;
const word = (value: unknown): value is string => typeof value === "string" && WORD.test(value);

function cleanProps(name: string, props: Record<string, unknown>): Props | null {
  switch (name) {
    case "app_open": return (props.kind === "desktop" || props.kind === "mobile") && PLATFORMS.includes(String(props.platform)) && typeof props.appVersion === "string" && VERSION.test(props.appVersion)
      ? { kind: props.kind, platform: String(props.platform), appVersion: props.appVersion } : null;
    case "app_close": return count(props.ms) ? { ms: props.ms } : null;
    case "app_screen": { const screen = typeof props.screen === "string" ? route(props.screen) : null; return screen ? { screen } : null; }
    case "app_feature": return APP_FEATURES.includes(props.feature as Feature) ? { feature: props.feature as Feature } : null;
    case "app_messages": return count(props.sent) && count(props.replies) && count(props.latencyMs) ? { sent: props.sent, replies: props.replies, latencyMs: props.latencyMs } : null;
    case "app_error": return word(props.kind) && word(props.code) ? { kind: props.kind, code: props.code } : null;
    case "app_pair_failed": return word(props.reason) ? { reason: props.reason } : null;
    default: return null;
  }
}

export function track(name: string, props: Record<string, unknown> = {}): void {
  try {
    if (!usageAnalyticsEnabled()) return;
    const clean = cleanProps(name, props);
    if (!clean) return;
    queue.push({ event: { name, at: Date.now(), props: clean }, retried: false });
    if (queue.length > 200) queue.splice(0, queue.length - 200);
    listen();
    schedule();
  } catch {}
}

export function screen(path: string): void {
  if (!usageAnalyticsEnabled()) return;
  const folded = route(path);
  if (!folded || folded === lastScreen) return;
  lastScreen = folded;
  track("app_screen", { screen: folded });
}

export function feature(name: Feature): void { track("app_feature", { feature: name }); }
export function error(kind: string, code: string): void { track("app_error", { kind, code }); }
export function pairFailed(reason: string): void { track("app_pair_failed", { reason }); }
export function messageSent(): void { if (usageAnalyticsEnabled()) { ++sent; schedule(); } }
export function replyReceived(latencyMs: number): void {
  if (!usageAnalyticsEnabled() || !Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs >= 1e12) return;
  ++replies;
  latencies.push(Math.round(latencyMs));
  schedule();
}

export async function flush(): Promise<void> {
  try {
    clearTimeout(timer);
    timer = undefined;
    if (!usageAnalyticsEnabled() || !options?.origin) { schedule(); return; }
    identity();
    if (sent || replies) {
      latencies.sort((a, b) => a - b);
      const middle = Math.floor(latencies.length / 2);
      const latencyMs = latencies.length ? Math.round(latencies.length % 2 ? latencies[middle] : (latencies[middle - 1] + latencies[middle]) / 2) : 0;
      track("app_messages", { sent, replies, latencyMs });
      sent = replies = 0;
      latencies = [];
    }
    const pending = queue.splice(0);
    const stamp = revision;
    const current = options;
    const failed = await Promise.all(Array.from({ length: Math.ceil(pending.length / 50) }, async (_, index): Promise<Pending[]> => {
      const batch = pending.slice(index * 50, (index + 1) * 50);
      try {
        await fetch(`${current.origin}/v1/app/events`, {
          method: "POST", keepalive: true, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
          headers: { "content-type": "application/json", ...(current.token ? { Authorization: `Bearer ${current.token}` } : {}) },
          body: JSON.stringify({ install, session, platform: current.platform, version: current.version, events: batch.map(item => item.event) }),
        });
        return [];
      } catch {
        return batch.filter(item => !item.retried).map(item => ({ ...item, retried: true }));
      }
    }));
    if (stamp === revision && usageAnalyticsEnabled()) queue = [...failed.flat(), ...queue].slice(-200);
    schedule();
  } catch {}
}

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flush(); });
  window.addEventListener("pagehide", () => {
    if (!closed) { closed = true; track("app_close", { ms: Math.max(0, Date.now() - started) }); }
    void flush();
  });
  window.addEventListener("pageshow", () => { closed = false; });
  window.addEventListener("error", () => error("window", "error"));
  window.addEventListener("unhandledrejection", () => error("window", "rejection"));
  window.addEventListener("storage", event => { if (event.key === "dusk-usage-analytics") usageAnalyticsEnabled(); });
}

export function configure(next: Options): void {
  try {
    forced = next.force === true;
    let origin: string | null = null;
    if (next.origin) {
      const url = new URL(next.origin);
      if (url.origin === next.origin.replace(/\/$/, "") && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) origin = url.origin;
    }
    options = { ...next, origin, version: VERSION.test(next.version) ? next.version : "0.0.0" };
    if (!usageAnalyticsEnabled()) return;
    listen();
    if (origin && !opened) {
      opened = true;
      track("app_open", { kind: next.kind, platform: next.platform, appVersion: options.version });
    }
    schedule();
  } catch {}
}

export function noteMessageSent(sendId: string): void {
  if (!usageAnalyticsEnabled() || sends.has(sendId)) return;
  messageSent();
  sends.set(sendId, { at: Date.now() });
  if (sends.size > 200) sends.delete(sends.keys().next().value!);
}

export function noteAcceptedMessage(sendId?: string, messageId?: string): void {
  if (!sendId || !messageId) return;
  const send = sends.get(sendId);
  if (send) send.message = messageId;
}

export function noteReplyTurn(turnId?: string, requestMessageId?: string): void {
  if (!usageAnalyticsEnabled()) return;
  const now = Date.now();
  if (turnId && !firstReplies.has(turnId)) {
    firstReplies.set(turnId, now);
    if (firstReplies.size > 200) firstReplies.delete(firstReplies.keys().next().value!);
  }
  if (!requestMessageId) return;
  for (const [id, send] of sends) {
    if (send.message !== requestMessageId) continue;
    sends.delete(id);
    replyReceived((turnId ? firstReplies.get(turnId) ?? now : now) - send.at);
    break;
  }
}

export function pairingFailure(code: string): void {
  const reason = ({ expired: "expired_code", unreachable: "network", "relay-unavailable": "network", refused: "refused", used: "used_code", mismatch: "mismatch", invalid: "invalid_code", unsupported: "unsupported" } as Record<string, string>)[code] ?? "unknown";
  pairFailed(reason);
}

export async function observePairing<T>(task: () => Promise<T>): Promise<T> {
  try { return await task(); }
  catch (cause) {
    const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
    pairingFailure(typeof code === "string" ? code : "unknown");
    throw cause;
  }
}

export function noteRoutineRun(id: string, status: string): void {
  if (!usageAnalyticsEnabled() || !["running", "waiting", "completed"].includes(status) || routineRuns.has(id)) return;
  routineRuns.add(id);
  if (routineRuns.size > 200) routineRuns.delete(routineRuns.values().next().value!);
  feature("routine_ran");
}
