import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Loader2, LockKeyhole, Maximize, Shrink } from "../../icons";

import { createBrowserControl, streamTransport, type BrowserControl, type BrowserTakeStatus } from "@/lib/browser-control";
import { browserStreamAccess, createPreviewStreamClient, type PreviewStreamClient, type PreviewStreamControl, type PreviewStreamInput } from "@/lib/browser-stream-client";
import { createLiveStreamClient, type LiveResume, type LiveStreamClient } from "@/lib/browser-stream-v1";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { addressParts, foldTabs, localBrowserFixture, minutesSince, pageTitle, siteOf, tabLetter, useLocalBrowser, type ClosedTabView, type LocalBrowserState } from "@/lib/local-browser";
import { usePageVisible } from "@/lib/page-visible";
import { siteIconUrl } from "@/lib/site-icon";
import { browserScope, withBrowserScope } from "@/lib/team-browser";
import { api, useStore, type Bot } from "@/state/store";
import { BROWSER_HELD_ELSEWHERE } from "../../../shared/browser-held";
import type { BrowserTab } from "../browser/ChromeRow";
import { StreamSurface, type SurfaceConnect } from "../browser/StreamSurface";
import { buttonCls } from "./rows";

/** Tabs the strip shows at the panel's width before the rest fold into "+N more". */
const STRIP_TABS = 2;

const pillCls = "dusk-press inline-flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-full px-2 text-[12px] leading-4 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";
const screenCls = "relative w-full overflow-hidden rounded-xl bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_6%)]";

function SiteMark({ title, url }: { title: string; url: string }) {
  const icon = siteIconUrl(siteOf(url));
  const [loaded, setLoaded] = useState<string | null>(null);
  const shown = icon !== null && loaded === icon;
  return (
    <span aria-hidden="true" className={cn("relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[4px] text-[10px] font-medium leading-none text-ink-secondary", !shown && "bg-ink/[0.08]")}>
      {!shown && tabLetter(title, url)}
      {icon && <img src={icon} alt="" draggable={false} onLoad={(event) => { if (event.currentTarget.naturalWidth > 1) setLoaded(icon); }}
        className={cn("absolute inset-0 size-full object-contain", !shown && "invisible")} />}
    </span>
  );
}

function tabName(tab: { title: string; url: string }): string {
  return pageTitle(tab.title, tab.url) || siteOf(tab.url) || t("browser.panel.newTab");
}

function AddressLine({ url, note }: { url: string; note?: string }) {
  const { host, rest } = addressParts(url);
  return (
    <div data-local-browser-address="" className="flex h-7 min-w-0 items-center gap-1.5 rounded-full bg-ink/[0.04] px-2.5 text-[12px] leading-4">
      <LockKeyhole size={11} aria-hidden="true" className="shrink-0 text-ink/[0.56]" />
      <span dir="ltr" className="min-w-0 truncate"><span className="font-medium text-ink">{host}</span><span className="text-ink/[0.56]">{rest}</span></span>
      {note && <span className="shrink-0 text-ink/[0.56]">· {note}</span>}
    </div>
  );
}

function TabStrip({ bot, tabs, selected, onSelect, dot }: {
  bot: Bot; tabs: BrowserTab[]; selected: string | null; onSelect: (tab: BrowserTab) => void; dot: "working" | "waiting" | null;
}) {
  const [unfolded, setUnfolded] = useState(false);
  const { shown, hidden } = unfolded ? { shown: tabs, hidden: 0 } : foldTabs(tabs, selected, STRIP_TABS);
  return (
    <div className={cn("flex items-center gap-1", unfolded && "flex-wrap")}>
      <div role="tablist" aria-label={t("localBrowser.tabs", { name: bot.name })} className="contents">
        {shown.map((tab) => {
          const chosen = tab.tabId === selected;
          const marked = tab.active && dot;
          return (
            <button key={tab.tabId} type="button" role="tab" aria-selected={chosen} data-local-browser-tab={tab.tabId} title={tab.title || tab.url}
              onClick={() => onSelect(tab)} className={cn(pillCls, unfolded ? "max-w-full" : "shrink", chosen ? "bg-ink/[0.06] text-ink" : "text-ink-secondary hover:bg-ink/[0.04] hover:text-ink")}>
              <SiteMark title={tab.title} url={tab.url} />
              <span dir="auto" className="min-w-0 max-w-[160px] truncate">{tabName(tab)}</span>
              {marked && <span role="img" data-tab-dot={dot} aria-label={t(dot === "waiting" ? "localBrowser.waitingDot" : "localBrowser.workingDot")}
                className={cn("size-1.5 shrink-0 rounded-full", dot === "waiting" ? "bg-warning" : "bg-success")} />}
            </button>
          );
        })}
      </div>
      {(hidden > 0 || unfolded) && tabs.length > STRIP_TABS && (
        <button type="button" aria-expanded={unfolded} data-local-browser-more="" onClick={() => setUnfolded((on) => !on)}
          className={cn(pillCls, "shrink-0 text-ink-secondary hover:bg-ink/[0.04] hover:text-ink")}>
          {unfolded ? t("localBrowser.fewer") : t("localBrowser.more", { count: hidden })}
        </button>
      )}
    </div>
  );
}

function tabsOf(value: unknown): BrowserTab[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tab) => tab && typeof tab === "object" && typeof tab.tabId === "string"
    ? [{ tabId: tab.tabId, title: typeof tab.title === "string" ? tab.title : "", url: typeof tab.url === "string" ? tab.url : "", active: tab.active === true }]
    : []);
}

/** The bot's browser while it has tabs open: its tabs, the address and the live page of the one shown, Take control and
 * Open big. The page takes no input until the person takes control; picking another tab brings it to the front. */
export function LocalBrowserLive({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const [fallback, setFallback] = useState(false);
  const stream = state.config?.browserEngine?.engine === "chrome" && !fallback;
  const [attempt, setAttempt] = useState(0);
  const [connected, setConnected] = useState(false);
  const [control, setControl] = useState<PreviewStreamControl | null>(null);
  const [tabs, setTabs] = useState<BrowserTab[]>(() => fixtureTabs());
  const [takeStatus, setTakeStatus] = useState<BrowserTakeStatus>("");
  const [error, setError] = useState("");
  const [big, setBig] = useState(false);
  const pageVisible = usePageVisible();
  const clientRef = useRef<PreviewStreamClient | null>(null);
  const controlRef = useRef<PreviewStreamControl | null>(null);
  const controlListeners = useRef(new Set<(control: PreviewStreamControl | null) => void>());
  const browserControl = useRef<BrowserControl | null>(null);
  const resume = useRef<LiveResume & { key: string }>({ key: "", viewer: "" });
  const scopedThread = browserScope(state.config?.team, bot.threadId).threadId;
  const help = state.computerControl?.[bot.id]?.help;
  const fixture = localBrowserFixture() !== null;
  const dot = help ? "waiting" : bot.busy || localBrowserFixture()?.working ? "working" : null;

  const connect = useCallback<SurfaceConnect>((target, events) => {
    const scope: Record<string, string> = scopedThread ? { threadId: scopedThread } : {};
    if (stream) return createPreviewStreamClient({ access: browserStreamAccess(bot.id, window.location, scope), ...target }, events);
    const key = `${bot.id}\n${bot.browserProfile ?? ""}${scopedThread ? `\n${scopedThread}` : ""}`;
    if (resume.current.key !== key) resume.current = { key, viewer: "" };
    return createLiveStreamClient(bot.id, events, (body, viewerId) => api(withBrowserScope(`/api/bots/${encodeURIComponent(bot.id)}/browser/action`, scope), {
      method: "POST", body: JSON.stringify({ ...body, viewerId }), timeoutMs: 120_000,
    }), resume.current, scope, { width: target.width, height: target.height });
  }, [bot.id, bot.browserProfile, scopedThread, stream]);

  const interact = useCallback((input: PreviewStreamInput) => {
    if (controlRef.current?.controller === "another-viewer") { setError(BROWSER_HELD_ELSEWHERE); return; }
    browserControl.current?.interact(input);
  }, []);

  const onClient = useCallback((client: PreviewStreamClient | null) => {
    clientRef.current = client;
    browserControl.current?.close();
    browserControl.current = null;
    if (!client) return;
    const transport = "transport" in client
      ? (client as LiveStreamClient).transport
      : streamTransport(client, {
        current: () => controlRef.current,
        watch: (listener) => { controlListeners.current.add(listener); return () => { controlListeners.current.delete(listener); }; },
      }, BROWSER_HELD_ELSEWHERE);
    browserControl.current = createBrowserControl({
      transport,
      owned: () => controlRef.current?.controller === "you",
      mine: () => controlRef.current?.owned === true,
      onTakeStatus: setTakeStatus,
      onError: setError,
      onHalted: () => setError(t("browser.input.tooSlow")),
    });
  }, []);

  const onControl = useCallback((next: PreviewStreamControl | null) => {
    controlRef.current = next;
    setControl(next);
    if (next === null) setTakeStatus("");
    for (const listener of controlListeners.current) listener(next);
    browserControl.current?.observe();
  }, []);

  const onMessage = useCallback((message: Readonly<Record<string, unknown>>) => {
    if (message.type === "tabs") setTabs(tabsOf(message.tabs));
  }, []);

  useEffect(() => () => { browserControl.current?.close(); }, []);

  // Open big lays the same view over the window; Escape brings it back, without reaching a dialog beneath.
  useEffect(() => {
    if (!big) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setBig(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [big]);

  const you = control?.controller === "you" || control?.owned === true;
  const takeControl = () => { setError(""); browserControl.current?.keep(true); browserControl.current?.takeControl(); };
  const handBack = () => { browserControl.current?.keep(false); browserControl.current?.handBack(); };
  const active = tabs.find((tab) => tab.active) ?? tabs[0] ?? null;
  const select = (tab: BrowserTab) => { if (!tab.active) interact({ type: "tabSelect", tabId: tab.tabId }); };
  const shown = pageVisible || you;
  const busy = takeStatus === "pending" || takeStatus === "slow";
  const status = you ? null : control?.controller === "another-viewer" ? BROWSER_HELD_ELSEWHERE
    : dot === "waiting" ? t("localBrowser.waiting") : dot === "working" ? t("localBrowser.using") : null;

  const view = (
    <section data-local-browser="live" data-big={big || undefined} role={big ? "dialog" : undefined} aria-modal={big || undefined} aria-label={t("localBrowser.label", { name: bot.name })}
      className={big ? "fixed inset-0 z-50 flex flex-col gap-2 bg-app p-4 text-ink" : "flex flex-col gap-2"}>
      {tabs.length > 0 && <TabStrip bot={bot} tabs={tabs} selected={active?.tabId ?? null} onSelect={select} dot={dot} />}
      {active?.url && active.url !== "about:blank" && <AddressLine url={active.url} />}
      <div className={cn(screenCls, big ? "min-h-0 flex-1" : "aspect-[16/10]")}>
        {fixture ? <FixturePage tab={active} /> : shown ? (
          <div className={cn("absolute inset-0 flex flex-col", !you && "pointer-events-none")} inert={!you || undefined}>
            <StreamSurface
              key={`${attempt}:${stream ? "stream" : "live"}:${bot.browserProfile ?? ""}`}
              connect={connect}
              input={interact}
              label={t("localBrowser.page", { name: bot.name })}
              onClient={onClient}
              onControl={onControl}
              onMessage={onMessage}
              onConnectedChange={(next) => { setConnected(next); if (next) setError(""); }}
              onUnauthorized={() => { if (stream) setFallback(true); else setAttempt((n) => n + 1); }}
              onGone={() => setConnected(false)}
            />
          </div>
        ) : null}
        {!fixture && !connected && (
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 text-[12px] leading-4 text-ink/[0.56]">
            <Loader2 size={14} aria-hidden="true" className="motion-safe:animate-spin" />{t("browser.panel.connecting")}
          </div>
        )}
      </div>
      {error && <p role="alert" className="m-0 text-[12px] leading-4 text-danger">{error}</p>}
      <div className="flex min-h-7 items-center gap-1.5">
        <span data-local-browser-status="" title={status ?? undefined} className="min-w-0 flex-1 truncate text-[12px] leading-4 text-ink/[0.56]">{status}</span>
        <button type="button" data-local-browser-action="big" className={buttonCls} onClick={() => setBig((on) => !on)}>
          {big ? <Shrink size={13} aria-hidden="true" /> : <Maximize size={13} aria-hidden="true" />}
          {t(big ? "localBrowser.closeBig" : "localBrowser.openBig")}
        </button>
        <button type="button" data-local-browser-action={you ? "hand-back" : "take"} className={buttonCls}
          disabled={!fixture && (!connected || busy || control?.controller === "another-viewer")} onClick={you ? handBack : takeControl}>
          {busy && <Loader2 size={13} aria-hidden="true" className="motion-safe:animate-spin" />}
          {t(you ? "browser.control.handBack" : "computer.takeControl")}
        </button>
      </div>
    </section>
  );
  // over the whole window: the panel's own layers would hold a fixed view inside them
  return big ? <>{createPortal(view, document.body)}<div className="aspect-[16/10] w-full rounded-xl bg-ink/[0.04]" /></> : view;
}

function fixtureTabs(): BrowserTab[] {
  const tabs = localBrowserFixture()?.tabs;
  return tabs ? tabs.map((tab, at) => ({ tabId: `t${at + 1}`, title: tab.title, url: tab.url, active: at === 0 })) : [];
}

/** The gallery's page: its tab's own last screen, as the server would stream it. */
function FixturePage({ tab }: { tab: BrowserTab | null }) {
  const image = localBrowserFixture()?.tabs?.find((one) => one.url === tab?.url)?.image;
  return image ? <img src={image} alt="" className="absolute inset-0 size-full object-cover object-top" /> : null;
}

/** For 30 minutes after the browser closed: that it closed, and the tabs it closed with; one opens its last screen. */
export function LocalBrowserClosed({ bot, closed }: { bot: Bot; closed: NonNullable<LocalBrowserState["closed"]> }) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => { setChosen(null); }, [closed.at]);
  const ago = minutesSince(closed.at, now);
  const when = ago < 1 ? t("localBrowser.justNow") : t("localBrowser.minutesAgo", { count: ago });
  const tab = chosen === null ? null : closed.tabs[chosen] ?? null;

  if (tab) {
    return (
      <section data-local-browser="last-screen" className="flex flex-col gap-2">
        <div className="flex min-h-7 items-center gap-2">
          <button type="button" data-local-browser-action="back" className={buttonCls} onClick={() => setChosen(null)}>
            <ArrowLeft size={13} aria-hidden="true" />{t("localBrowser.back")}
          </button>
          <span dir="auto" className="min-w-0 flex-1 truncate text-end text-[12px] leading-4 text-ink/[0.56]">{pageTitle(tab.title, tab.url) || siteOf(tab.url)} · {when}</span>
        </div>
        <AddressLine url={tab.url} note={t("localBrowser.lastScreenNote")} />
        <div className={cn(screenCls, "aspect-[16/10]")}>
          {tab.image
            ? <img src={tab.image} alt={t("localBrowser.lastScreen", { title: pageTitle(tab.title, tab.url) || siteOf(tab.url) })} className="absolute inset-0 size-full object-cover object-top" />
            : <p className="absolute inset-0 m-0 flex items-center justify-center px-6 text-center text-[12px] leading-4 text-ink/[0.56]">{t("localBrowser.noScreen")}</p>}
        </div>
      </section>
    );
  }

  return (
    <section data-local-browser="closed" className="flex flex-col gap-2">
      <div className="flex flex-col items-center gap-1 rounded-xl bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_6%)] px-5 py-5 text-center">
        <p className="m-0 text-[13px] font-medium leading-[18px] text-ink">{t("localBrowser.closedTitle")}</p>
        <p className="m-0 text-pretty text-[12px] leading-4 text-ink-secondary">{t("localBrowser.closedBody", { name: bot.name })}</p>
      </div>
      <h3 className="m-0 mt-1 px-1 text-[12px] font-normal leading-4 text-ink/[0.56]">{t("localBrowser.workedOn")}</h3>
      <ul className="m-0 flex list-none flex-col p-0">
        {closed.tabs.map((one, index) => (
          <li key={`${one.url}:${index}`}>
            <ClosedRow tab={one} when={when} onOpen={() => setChosen(index)} />
          </li>
        ))}
      </ul>
      <p className="m-0 px-1 text-[12px] leading-4 text-ink/[0.56]">{t("localBrowser.workedOnHint")}</p>
    </section>
  );
}

function ClosedRow({ tab, when, onOpen }: { tab: ClosedTabView; when: string; onOpen: () => void }) {
  const site = siteOf(tab.url);
  return (
    <button type="button" data-local-browser-closed-tab="" onClick={onOpen}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 text-left hover:bg-ink/[0.04] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
      <span aria-hidden="true" className="relative flex h-8 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-ink/[0.06]">
        {tab.image ? <img src={tab.image} alt="" loading="lazy" draggable={false} className="absolute inset-0 size-full object-cover object-top" /> : <SiteMark title={tab.title} url={tab.url} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span dir="auto" className="truncate text-[13px] leading-[18px] text-ink">{pageTitle(tab.title, tab.url) || site}</span>
        <span className="truncate text-[12px] leading-4 text-ink/[0.56]">{site}</span>
      </span>
      <span className="shrink-0 text-[12px] leading-4 text-ink/[0.56]">{when}</span>
    </button>
  );
}

/** A bot's browser on this computer in its Computer tab: the live tabs while it is open, what it closed with for 30
 * minutes after, and nothing otherwise. */
export function LocalBrowserSection({ bot }: { bot: Bot }) {
  const { open, closed } = useLocalBrowser(bot.id, bot.threadId, bot.browser !== false);
  if (open) return <LocalBrowserLive key={bot.id} bot={bot} />;
  return closed ? <LocalBrowserClosed bot={bot} closed={closed} /> : null;
}
