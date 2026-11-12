// Adding a place from the places hub or the switcher: dusk cloud, or a server of the person's own, linked by one line
// through the relay (electron/vps-link.mjs) or reached at an address it already has (a pairing link, main's
// connectHostedWorkspace). The sheet itself is components/PlaceSetup.tsx.
import { useSyncExternalStore } from "react";
import type { VpsLinkView } from "./vps-link";

export type InstallPhase = "starting" | "waiting" | "found" | "connecting" | "done" | "failed" | "expired";

/** Where a one-line install stands, from main's link view: waiting for the server to check in, found it, setting it up,
 * done; or stopped (an error or a failed step) or out of time. */
export function installPhase(view: VpsLinkView, now: number): InstallPhase {
  if (view.server && (view.stage === "linked" || view.stage === "moving" || view.stage === "moved")) return "done";
  if (view.error || view.stage === "error" || view.steps.some((step) => step.status === "failed")) return "failed";
  if (view.stage === "installing") return view.steps.some((step) => step.status === "done" || step.status === "skipped") ? "connecting" : "found";
  if (view.stage === "command" && view.command) return view.expiresAt !== null && view.expiresAt <= now ? "expired" : "waiting";
  return "starting";
}

/** The four steps the sheet lists, each done, now or next. A stop keeps the step it stopped on as now. */
export function installChecklist(view: VpsLinkView, now: number): Array<{ key: "waiting" | "found" | "connecting" | "done"; state: "done" | "now" | "next" }> {
  const phase = installPhase(view, now);
  const order = ["waiting", "found", "connecting", "done"] as const;
  const reached = phase === "failed" || phase === "expired"
    ? (view.steps.some((step) => step.status === "done" || step.status === "skipped") ? "connecting" : view.steps.some((step) => step.status !== "waiting") ? "found" : "waiting")
    : phase === "starting" ? "waiting" : phase;
  const index = order.indexOf(reached);
  return order.map((key, step) => ({ key, state: phase === "done" || step < index ? "done" : step === index ? "now" : "next" }));
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const CODE = /^([A-Z0-9]{4})-?([A-Z0-9]{4})-?([A-Z0-9]{4})$/;

/** The pairing link main opens, from what the person typed: a whole pairing link as it is, or an address (https, or plain
 * http on this computer for an SSH tunnel) and an optional code. */
export function pairingLink(address: string, code: string): { link: string } | { error: "address" | "code" } {
  const typed = address.trim();
  if (!typed) return { error: "address" };
  if (/#code=/.test(typed)) return { link: typed };
  let url: URL;
  // a bare loopback address is an SSH tunnel, which speaks plain http
  const scheme = /^(?:localhost|127\.0\.0\.1|\[::1\])(?:[:/]|$)/i.test(typed) ? "http" : "https";
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `${scheme}://${typed}`); } catch { return { error: "address" }; }
  const loopback = LOOPBACK.has(url.hostname);
  if (url.username || url.password || url.search || !(url.protocol === "https:" || (url.protocol === "http:" && loopback))) return { error: "address" };
  if (!loopback && !url.hostname.includes(".")) return { error: "address" };
  const cleaned = code.replace(/\s+/g, "").toUpperCase();
  if (!cleaned) return { link: url.origin };
  const parts = CODE.exec(cleaned);
  if (!parts) return { error: "code" };
  return { link: `${url.origin}/pair#code=${parts[1]}-${parts[2]}-${parts[3]}` };
}

let open = false;
const watchers = new Set<() => void>();
const tell = () => { for (const watch of Array.from(watchers)) watch(); };
export function openPlaceSetup(): void { open = true; tell(); }
export function closePlaceSetup(): void { open = false; tell(); }
export function usePlaceSetupOpen(): boolean {
  return useSyncExternalStore((watch) => { watchers.add(watch); return () => { watchers.delete(watch); }; }, () => open, () => false);
}
