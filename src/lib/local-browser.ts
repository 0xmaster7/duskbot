import { useEffect, useState } from "react";

import { api } from "@/state/api";
import { usePageVisible } from "./page-visible";

export interface ClosedTabView {
  title: string;
  url: string;
  /** The last screen's address, or null when none was kept. */
  image: string | null;
}

export interface LocalBrowserState {
  open: boolean;
  closed: { at: number; tabs: ClosedTabView[] } | null;
}

const POLL_MS = 5_000;
const NONE: LocalBrowserState = { open: false, closed: null };

/** The surfaces gallery's stand-in for the server's answer; `tabs`, an open browser's tabs, each with a still page. */
export type LocalBrowserFixture = LocalBrowserState & { tabs?: ClosedTabView[]; working?: boolean };
let fixture: LocalBrowserFixture | null = null;
export function setLocalBrowserFixture(next: LocalBrowserFixture | null): void { fixture = next; }
export const localBrowserFixture = (): LocalBrowserFixture | null => fixture;

export function recentPath(botId: string, threadId: string | undefined, index?: number): string {
  const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
  return `/api/bots/${encodeURIComponent(botId)}/browser/recent${index === undefined ? "" : `/${index}`}${query}`;
}

export function parseLocalBrowser(value: unknown, botId: string, threadId: string | undefined): LocalBrowserState {
  const reply = value as { open?: unknown; closed?: { at?: unknown; tabs?: unknown } | null } | null;
  const at = reply?.closed?.at;
  const tabs = Array.isArray(reply?.closed?.tabs) ? reply.closed.tabs : [];
  const closed = typeof at === "number" && tabs.length > 0 ? {
    at,
    tabs: tabs.flatMap((tab: { title?: unknown; url?: unknown; image?: unknown }, index: number) => typeof tab?.url === "string"
      ? [{ title: typeof tab.title === "string" ? tab.title : "", url: tab.url, image: tab.image === true ? `${recentPath(botId, threadId, index)}${threadId ? "&" : "?"}at=${at}` : null }]
      : []),
  } : null;
  return { open: reply?.open === true, closed };
}

/** Whether a bot's browser on this computer is open now, and what it closed with in the last 30 minutes. Asked again every
 * few seconds while the page shows; asking never starts the browser. */
export function useLocalBrowser(botId: string, threadId: string | undefined, enabled: boolean): LocalBrowserState {
  const [state, setState] = useState<LocalBrowserState>(() => fixture ?? NONE);
  const visible = usePageVisible();
  useEffect(() => {
    if (fixture) { setState(fixture); return; }
    if (!enabled || !visible) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      try {
        const next = parseLocalBrowser(await api(recentPath(botId, threadId), { background: true, signal: controller.signal }), botId, threadId);
        if (!controller.signal.aborted) setState((current) => sameState(current, next) ? current : next);
      } catch {
        // an older server without the route, or a blip: the panel keeps what it showed
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void ask(), POLL_MS);
      }
    };
    void ask();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [botId, threadId, enabled, visible]);
  return state;
}

function sameState(a: LocalBrowserState, b: LocalBrowserState): boolean {
  return a.open === b.open && a.closed?.at === b.closed?.at && a.closed?.tabs.length === b.closed?.tabs.length;
}

/** The site a person recognises: the host without a leading www. */
export function siteOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/** A page's own title; agent-browser names a page it has no title for by its address, which is no title at all. */
export function pageTitle(title: string, url: string): string {
  const trimmed = title.trim();
  const bare = (value: string) => value.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  return trimmed && bare(trimmed) !== bare(url) && bare(trimmed) !== siteOf(url) ? trimmed : "";
}

/** The address line's two halves: the host, then the rest. */
export function addressParts(url: string): { host: string; rest: string } {
  try {
    const parsed = new URL(url);
    const rest = `${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`;
    return { host: parsed.hostname.replace(/^www\./, ""), rest };
  } catch {
    return { host: url, rest: "" };
  }
}

/** One letter for a tab with no icon: the site's, else the title's. */
export function tabLetter(title: string, url: string): string {
  const source = siteOf(url) || title;
  return (source.match(/[\p{L}\p{N}]/u)?.[0] ?? "·").toUpperCase();
}

/** The tabs the strip shows before folding the rest into "+N more": the selected one always among them. */
export function foldTabs<T extends { tabId: string }>(tabs: readonly T[], selected: string | null, max: number): { shown: T[]; hidden: number } {
  if (tabs.length <= max) return { shown: [...tabs], hidden: 0 };
  const first = tabs.slice(0, max);
  const chosen = selected ? tabs.find((tab) => tab.tabId === selected) : undefined;
  const shown = chosen && !first.includes(chosen) ? [...first.slice(0, max - 1), chosen] : first;
  return { shown, hidden: tabs.length - shown.length };
}

/** Whole minutes since, for the closed list. */
export function minutesSince(at: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - at) / 60_000));
}
