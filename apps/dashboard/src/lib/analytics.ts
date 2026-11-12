import { CSRF_COOKIE, CSRF_HEADER } from "../../../../shared/account-api";
import { UPSELL_EVENTS, type UpsellStep } from "../../../../shared/cloud-upsell";

type PageEvent = { name: "page_view"; props: { path: string } } | { name: "onboarding_step"; props: { step: string; ms?: number } } | { name: "onboarding_done" }
  | { name: "plan_chosen"; props: { plan: string; period: "month" | "year" } } | { name: "page_action"; props: { action: string; path: string; label?: string; value?: string } }
  | { name: "download_click"; props: { platform: string; detected_os: string } };

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
  // a redirect sends a second page view straight after the first; keep only where the person landed
  if (event.name === "page_view" && queue.at(-1)?.name === "page_view") queue.pop();
  queue.push(event);
  timer ??= setTimeout(flush, 800);
}

const ID_LIKE = /@|\d{4,}|^(?:ws|acct|bot|ses|cmd|c)_/i;
/** a static name as an analytics word: lowercase, underscores, at most four words; null for anything that looks typed or like an id */
export function slug(raw: string | null | undefined): string | null {
  if (!raw || ID_LIKE.test(raw)) return null;
  const out = raw.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 4).join("_").slice(0, 40);
  return out || null;
}

/** what a click or a choice was, from the element alone; text inside list rows and tables is people's own data, so only a declared name counts there */
export function actionOf(el: Element, kind: "click" | "change"): { action: string; label?: string; value?: string } | null {
  if (el.closest("[data-private], [data-track-ignore]")) return null;
  if (kind === "change") {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return null;
    const type = el instanceof HTMLInputElement ? el.type : "select";
    if (!["radio", "checkbox", "select"].includes(type)) return null;
    const label = slug(el.getAttribute("data-track") ?? el.name ?? el.id);
    if (!label) return null;
    const value = type === "checkbox" ? ((el as HTMLInputElement).checked ? "on" : "off") : slug(el.value);
    return { action: "choose", label, ...(value ? { value } : {}) };
  }
  const target = el.closest("a[href], button, [role=button], [role=tab], [role=menuitem]");
  if (!target) return null;
  const inRow = !!target.closest("li, tr");
  const label = slug(target.getAttribute("data-track") ?? target.getAttribute("aria-label") ?? (inRow ? null : target.textContent));
  const href = target instanceof HTMLAnchorElement ? target.href : "";
  if (/\/download\b/.test(href)) {
    const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
    const value = /iphone|ipad/i.test(ua) ? "ios" : /android/i.test(ua) ? "android" : /mac/i.test(ua) ? "mac" : /win/i.test(ua) ? "windows" : /linux/i.test(ua) ? "linux" : null;
    return { action: "download", ...(label ? { label } : {}), ...(value ? { value } : {}) };
  }
  return { action: inRow && !label ? "row_click" : "click", ...(label ? { label } : {}) };
}

let listening = false;
let currentPath = "/";
let stepAt: number | null = null;
function listen() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  const send = (found: ReturnType<typeof actionOf>) => { if (found) track({ name: "page_action", props: { ...found, path: currentPath } }); };
  document.addEventListener("click", (e) => { if (e.target instanceof Element && !(e.target instanceof HTMLInputElement)) send(actionOf(e.target, "click")); }, true);
  document.addEventListener("change", (e) => {
    const box = e.target;
    if (box instanceof HTMLInputElement && box.type === "search") { if (box.value.trim()) send({ action: "search", label: slug(box.id || box.name) ?? "search" }); return; }
    if (box instanceof Element) send(actionOf(box, "change"));
  }, true);
}

/** one page view per route change; the onboarding step rides along with how long the step before it took */
export function trackPage(path: string, query: URLSearchParams) {
  if (path === "/admin" || path.startsWith("/admin/")) return;
  currentPath = path;
  if (live() && !declined()) listen();
  track({ name: "page_view", props: { path } });
  const step = query.get("step");
  if (path === "/welcome" && step) {
    const now = Date.now();
    track({ name: "onboarding_step", props: { step, ...(stepAt !== null ? { ms: now - stepAt } : {}) } });
    stepAt = now;
  }
}

/** a dusk cloud upsell seen, opened or put away; label is its checkout source, so the funnel can line them up */
export function trackUpsell(step: UpsellStep, source: "dash_sidebar" | "dash_invested" | "dash_routines") {
  track({ name: "page_action", props: { action: UPSELL_EVENTS[step], path: currentPath, label: source } });
}
