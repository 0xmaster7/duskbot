import { CSRF_COOKIE, CSRF_HEADER } from "../../../../shared/account-api";

type PageEvent = { name: "page_view"; props: { path: string } } | { name: "onboarding_step"; props: { step: string } } | { name: "onboarding_done" } | { name: "plan_chosen"; props: { plan: string; period: "month" | "year" } };

const declined = () => typeof navigator !== "undefined" && ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true || navigator.doNotTrack === "1");
const live = () => typeof window !== "undefined" && !(import.meta.env.DEV && new URLSearchParams(location.search).has("fixture")) && import.meta.env.MODE !== "test";

function sessionId(): string {
  try {
    const saved = sessionStorage.getItem("omb-dash-visit");
    if (saved) return saved;
    const fresh = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem("omb-dash-visit", fresh);
    return fresh;
  } catch { return "unavailable"; }
}

let queue: PageEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let first = true;

function flush() {
  timer = null;
  if (!queue.length) return;
  const events = queue.splice(0, 20);
  const csrf = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${CSRF_COOKIE}=`))?.slice(CSRF_COOKIE.length + 1) ?? "";
  const body = { events, session: sessionId(), ...(first ? { referrer: document.referrer || undefined, landing: location.href } : {}) };
  first = false;
  void fetch("/v1/events", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "content-type": "application/json", [CSRF_HEADER]: decodeURIComponent(csrf) }, body: JSON.stringify(body) }).catch(() => {});
  if (queue.length) flush();
}

/** product analytics: what was used, never what was typed; skipped when the browser asks not to be tracked */
export function track(event: PageEvent) {
  if (!live() || declined()) return;
  queue.push(event);
  timer ??= setTimeout(flush, 800);
}

/** one page view per route change; the onboarding step rides along as its own event */
export function trackPage(path: string, query: URLSearchParams) {
  if (path === "/admin" || path.startsWith("/admin/")) return;
  track({ name: "page_view", props: { path } });
  const step = query.get("step");
  if (path === "/welcome" && step) track({ name: "onboarding_step", props: { step } });
}
