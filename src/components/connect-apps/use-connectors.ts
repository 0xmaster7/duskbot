import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { readCachedInventory } from "@/lib/connected-apps-cache";
import { connectorStatusMemory, preloadConnectedApps, rememberConnectorStatus } from "@/lib/connected-apps";
import { reserveConnectionPage, reusableConnectionUrl, type PendingAuthorization } from "@/lib/connector-oauth";
import { mcpSignInLink, runMcpSignIn } from "@/lib/mcp-sign-in";
import { pollConnector } from "@/lib/connector-poll";
import { connectorConnect } from "@/lib/product-events";
import { lacksAdminScope } from "@/lib/admin-scope";
import { accountAliasTaken, accountToReconnect, hasActiveConnection, requiresAccountAlias, type ConnectorAccount, type ConnectorInventoryPhase, type ConnectorStatus } from "@/lib/connector-status";
import { mergeCompleteConnectorStatus, mergeCurrentConnectorStatus, onlyLatestConnectorResponses } from "@/lib/connector-status-merge";
import { COMPOSIO_AUTH_CONFIGS_URL, managedConnectorUnavailableReason, needsComposioAuthConfig } from "../../../shared/connector-availability";
import type { ToolkitCard } from "../ServiceIcon";
import { cachedComposioSnapshot, loadComposioSnapshot, mergeCatalog } from "./composio-snapshot";
import { classifyViaError, keepPendingVia, readPendingVia, VIA_DEADLINE_MS, viaDelay, type ViaFailure, type ViaFlow } from "./via-flow";

export type ConnectorError = string | { key: LocaleKey } | null;
/** Composio Connect, Composio's own MCP server, signed in with Composio's page: apps connect through it with no key. */
export interface ComposioConnect { added: boolean; name: string | null; signedIn: boolean; enabled: boolean }
export const COMPOSIO_CONNECT_NAME = "composio-connect";
export const COMPOSIO_CONNECT_URL = "https://connect.composio.dev/mcp";
const VIA_APPS = "omb.composioConnect.apps";
function readViaApps(): Record<string, true> {
  try { return JSON.parse(localStorage.getItem(VIA_APPS) ?? "{}") as Record<string, true>; } catch { return {}; }
}
export type ConnectionPage = ReturnType<typeof reserveConnectionPage>;
export type ConnectorMode = "managed" | "self-hosted" | "unavailable";

/** What a Composio app's row and page show. */
export type ConnectorPhase =
  | { kind: "checking" }
  | { kind: "connect" }
  | { kind: "connecting" }
  | { kind: "continue"; url: string | null }
  | { kind: "reconnect"; account: ConnectorAccount }
  | { kind: "connected" }
  | { kind: "included" }
  /** Its sign-in is set up on Composio first; Connect opened that page, and connecting again picks it up. */
  | { kind: "setup" }
  /** Its Composio Connect sign-in failed: why, so the page can say it and offer Retry or Authorize again. */
  | { kind: "failed"; why: ViaFailure; message?: string }
  | { kind: "unavailable"; reason: string };

export interface Connectors {
  cards: ToolkitCard[] | null;
  /** The bundled catalog, the live one and what is connected have each answered once, or were already in memory: the
   * window draws its rows from here on and later answers only update them in place. */
  ready: boolean;
  configured: boolean;
  mode: ConnectorMode;
  setup: "ready" | "needs-setup" | "service-unavailable" | undefined;
  stale: boolean;
  phase: ConnectorInventoryPhase;
  status: Record<string, ConnectorStatus>;
  error: ConnectorError;
  /** The app whose next Connect needs a name for the new account. */
  aliasFor: string | null;
  /** The app whose last Connect opened Composio to set its sign-in up. */
  setupFor: string | null;
  /** The app whose Connect waits for a Composio sign-in or key. */
  keyFor: string | null;
  /** Composio Connect, once read. */
  via: ComposioConnect | null;
  /** Apps connected through Composio Connect on this device. */
  viaApps: Record<string, true>;
  /** Where each app's Composio Connect sign-in is: authorizing Composio, waiting on Composio's page, done or failed. */
  viaFlow: Record<string, ViaFlow>;
  /** The app connects through Composio Connect: no broker or key for it. */
  viaRoute: (slug: string) => boolean;
  /** Step one: adds Composio Connect when it is missing, signs in on Composio's page in the tab reserved on the click,
   * and turns it on for bots. The app's own Connect is step two. */
  authorizeComposio: (slug: string) => Promise<void>;
  /** Opens the app's pending Composio page again, in the tab reserved on the click. */
  reopenVia: (slug: string) => void;
  /** Asks Composio once, reading only, whether the app is connected already (another device, an earlier try). */
  checkVia: (slug: string) => void;
  setError: (error: ConnectorError) => void;
  askAlias: (slug: string | null) => void;
  askKey: (slug: string | null) => void;
  phaseOf: (card: ToolkitCard, policyBlocked: string | null) => ConnectorPhase;
  isConnected: (slug: string) => boolean;
  connect: (slug: string, alias?: string, replacing?: ConnectorAccount) => Promise<void>;
  /** After a Composio key is saved: reads the catalog and connections again, then goes on with `slug`'s Connect in the tab
   * reserved on the click, unless the key's project already has it connected. */
  continueAfterKey: (slug: string, launch: ConnectionPage) => Promise<void>;
  resume: (slug: string) => void;
  /** Resolves false when Composio would not remove the account. */
  disconnect: (slug: string, accountId: string) => Promise<boolean>;
  reload: () => void;
}

interface CatalogAnswer { cards?: ToolkitCard[]; configured?: boolean; mode?: ConnectorMode; setup?: Connectors["setup"]; source?: "api" | "curated" }
let catalogAnswer: CatalogAnswer | null = null;
let catalogRequest: Promise<CatalogAnswer> | null = null;

/** Reads the catalog again; the window opens on the last answer while a newer one comes. */
export function loadConnectorCatalog(): Promise<CatalogAnswer> {
  catalogRequest ??= (api("/api/connectors/catalog") as Promise<CatalogAnswer>)
    .then((answer) => (catalogAnswer = answer))
    .finally(() => { catalogRequest = null; });
  return catalogRequest;
}

export const cachedConnectorCatalog = (): CatalogAnswer | null => catalogAnswer;

/** A new answer even when one is on its way: a key saved meanwhile changes what the catalog says. */
function reloadConnectorCatalog(): Promise<CatalogAnswer> {
  const pending = catalogRequest;
  return (pending ?? Promise.resolve(null)).catch(() => null).then(() => { catalogRequest = null; return loadConnectorCatalog(); });
}

/** The Composio catalog and its connections, with the same connect flow the Apps page has always run: reserve the tab on
 * the click, authorize, open the sign-in page, then poll until the account turns up. */
export function useConnectors(): Connectors {
  const [live, setLive] = useState<ToolkitCard[] | null>(() => catalogAnswer ? catalogAnswer.cards ?? [] : null);
  const [source, setSource] = useState(() => catalogAnswer?.source);
  const [bundled, setBundled] = useState(cachedComposioSnapshot);
  const [bundledSettled, setBundledSettled] = useState(() => cachedComposioSnapshot() !== null);
  const [liveSettled, setLiveSettled] = useState(() => catalogAnswer !== null);
  const [configured, setConfigured] = useState(() => Boolean(catalogAnswer?.configured));
  const [mode, setMode] = useState<ConnectorMode>(() => catalogAnswer?.mode ?? "unavailable");
  const [setup, setSetup] = useState<Connectors["setup"]>(() => catalogAnswer?.setup);
  const [status, setStatus] = useState<Record<string, ConnectorStatus>>(() => connectorStatusMemory()?.services ?? readCachedInventory()?.services ?? {});
  const [stale, setStale] = useState(connectorStatusMemory()?.authoritative === false);
  const [phase, setPhase] = useState<ConnectorInventoryPhase>(connectorStatusMemory() === null ? "loading" : "ready");
  const [pendingUrls, setPendingUrls] = useState<Record<string, PendingAuthorization>>({});
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [aliasFor, setAliasFor] = useState<string | null>(null);
  const [setupFor, setSetupFor] = useState<string | null>(null);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [via, setVia] = useState<ComposioConnect | null>(null);
  const [viaApps, setViaApps] = useState<Record<string, true>>(readViaApps);
  const [viaFlow, setViaFlow] = useState<Record<string, ViaFlow>>({});
  const viaPolls = useRef(new Map<string, () => void>());
  const viaNow = useRef<ComposioConnect | null>(null);
  viaNow.current = via;
  // apps the broker's project cannot sign in to: Composio Connect connects them once signed in
  const unmanaged = useRef(new Set<string>());
  const [error, setError] = useState<ConnectorError>(null);
  const [reloads, setReloads] = useState(0);

  const polls = useRef(new Map<string, () => void>());
  const generations = useRef(new Map<string, number>());
  const latestRequests = useRef(new Map<string, number>());
  const opening = useRef<ConnectionPage | null>(null);
  const modeNow = useRef(mode);
  modeNow.current = mode;

  const forgetSettled = (services: Record<string, ConnectorStatus>, requested: ReadonlyMap<string, number>) => {
    const settled = Object.entries(services).filter(([slug, state]) => (generations.current.get(slug) ?? 0) === (requested.get(slug) ?? 0)
      && ((state.connected && !state.pending) || /^(expired|failed)$/i.test(state.status ?? ""))).map(([slug]) => slug);
    if (settled.length) setPendingUrls((current) => settled.some((slug) => current[slug]) ? Object.fromEntries(Object.entries(current).filter(([slug]) => !settled.includes(slug))) : current);
  };

  const refreshStatus = useCallback((slugs: string[]): Promise<Record<string, ConnectorStatus>> => {
    if (!slugs.length) return Promise.resolve({});
    const requested = new Map(slugs.map((slug) => [slug, generations.current.get(slug) ?? 0]));
    const ids = new Map(slugs.map((slug) => {
      const id = (latestRequests.current.get(slug) ?? 0) + 1;
      latestRequests.current.set(slug, id);
      return [slug, id];
    }));
    return api(`/api/connectors?services=${slugs.join(",")}`)
      .then((response) => {
        const services = onlyLatestConnectorResponses(response.services ?? {}, latestRequests.current, ids);
        setStatus((current) => mergeCurrentConnectorStatus(current, services, generations.current, requested));
        forgetSettled(services, requested);
        return services;
      })
      .catch(() => ({}));
  }, []);

  useEffect(() => {
    let alive = true;
    const hadInventory = connectorStatusMemory() !== null;
    if (!hadInventory) setPhase("loading");
    const requested = new Map(generations.current);
    preloadConnectedApps(reloads > 0)
      .then(({ services, authoritative, refused }) => {
        if (!alive) return;
        setStale(!authoritative);
        if (refused) setError({ key: "connectors.adminOnly" });
        setStatus((current) => mergeCompleteConnectorStatus(current, services, generations.current, requested, authoritative));
        forgetSettled(services, requested);
        setPhase("ready");
      })
      .catch((cause) => {
        if (!alive) return;
        if (!hadInventory) setPhase("error");
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    api("/api/connectors/composio-connect")
      .then((answer: ComposioConnect) => { if (alive) setVia(answer); })
      .catch(() => { if (alive) setVia(null); });
    loadConnectorCatalog()
      .then((response) => {
        if (!alive) return;
        setLive(response.cards ?? []);
        setSource(response.source);
        setConfigured(Boolean(response.configured));
        setMode(response.mode ?? "unavailable");
        setSetup(response.setup);
        setLiveSettled(true);
      })
      .catch((cause) => {
        if (!alive) return;
        setLiveSettled(true);
        setLive((current) => current ?? []);
        setError(lacksAdminScope(cause) ? { key: "connectors.adminOnly" } : cause.message);
      });
    return () => { alive = false; };
  }, [reloads]);

  useEffect(() => {
    let alive = true;
    if (!bundled) void loadComposioSnapshot().then((answer) => { if (alive && answer) setBundled(answer); }).finally(() => { if (alive) setBundledSettled(true); });
    return () => { alive = false; };
  }, [bundled]);
  // every Composio toolkit, whether or not a broker or key can list them live
  const cards = useMemo(() => mergeCatalog(live, source, bundled), [live, source, bundled]);

  useEffect(() => {
    if (phase === "ready") rememberConnectorStatus(status, !stale);
  }, [phase, stale, status]);

  useEffect(() => () => {
    opening.current?.cancel();
    opening.current = null;
    for (const stop of polls.current.values()) stop();
    polls.current.clear();
    for (const stop of viaPolls.current.values()) stop();
    viaPolls.current.clear();
  }, []);

  const startPolling = (slug: string, before: ConnectorStatus | undefined) => {
    polls.current.get(slug)?.();
    const stop = pollConnector(before, () => refreshStatus([slug]).then((services) => services[slug]), (result) => {
      if (polls.current.get(slug) === stop) polls.current.delete(slug);
      connectorConnect(slug, result);
    });
    polls.current.set(slug, stop);
  };

  // no broker and no key, or an app the broker cannot sign in to: through Composio Connect, when signed in to it
  const throughConnect = (slug: string) => viaNow.current?.signedIn === true && (!configured || unmanaged.current.has(slug));

  const connect = async (slug: string, alias?: string, replacing?: ConnectorAccount) => {
    if (busySlug || opening.current) return;
    if (throughConnect(slug) && !replacing) { await connectVia(slug, reserveConnectionPage()); return; }
    await run(slug, reserveConnectionPage(), alias, replacing);
  };

  const flowOf = (slug: string, next: ViaFlow | null) => setViaFlow((current) => {
    const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== slug));
    return next ? { ...rest, [slug]: next } : rest;
  });

  const markVia = (slug: string, connected: boolean) => {
    setViaApps((current) => {
      const next: Record<string, true> = { ...current };
      if (connected) next[slug] = true; else delete next[slug];
      try { localStorage.setItem(VIA_APPS, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  };

  type ViaAnswer = { status: "connected" } | { status: "started"; url: string } | { status: "waiting" } | { status: "none" } | { status: "failed"; message: string };
  // GET only reads; POST reads, then starts a sign-in link only when the app has no account yet
  const askVia = (slug: string, method: "GET" | "POST") => api(`/api/connectors/composio-connect/apps/${encodeURIComponent(slug)}`, { method }) as Promise<ViaAnswer>;

  const stopVia = (slug: string) => { viaPolls.current.get(slug)?.(); viaPolls.current.delete(slug); };

  // connected: on this device's list, the server on for bots, and a short confirmation from the window
  const finishVia = async (slug: string) => {
    stopVia(slug);
    keepPendingVia(slug, null);
    markVia(slug, true);
    flowOf(slug, { step: "done" });
    connectorConnect(slug, "connected");
    const now = viaNow.current;
    if (now?.added && !now.enabled) {
      try {
        await api(`/api/mcp/servers/${encodeURIComponent(now.name ?? COMPOSIO_CONNECT_NAME)}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
        const next = { ...now, enabled: true };
        viaNow.current = next;
        setVia(next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  };

  const failVia = (slug: string, why: ViaFailure, message?: string) => {
    stopVia(slug);
    keepPendingVia(slug, null);
    flowOf(slug, { step: "failed", why, ...(message ? { message } : {}) });
    connectorConnect(slug, "failed");
    if (why === "signedOut" && viaNow.current) {
      const next = { ...viaNow.current, signedIn: false };
      viaNow.current = next;
      setVia(next);
    }
  };

  /** Waits for the sign-in on Composio's page: reads the app's accounts with backoff, at once when the window is back in
   * front, until one is active, the page is closed, the link expires, or Composio says the sign-in is gone. Trouble
   * reaching MausBot or Composio (a restart, the network) is retried and said, never silent. */
  const pollVia = (slug: string, url: string, since: number, closed?: () => boolean) => {
    stopVia(slug);
    let alive = true;
    let busy = false;
    let attempt = 0;
    let back = false;
    let trouble = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!alive || busy) return;
      busy = true;
      clearTimeout(timer);
      const wasClosed = closed?.() === true;
      try {
        const answer = await askVia(slug, "GET");
        if (!alive) return;
        trouble = false;
        if (answer.status === "connected") { void finishVia(slug); return; }
        if (wasClosed) { failVia(slug, "cancelled"); return; }
        flowOf(slug, { step: "waiting", url, since, ...(back ? { note: "notYet" as const } : {}) });
      } catch (cause) {
        if (!alive) return;
        const failure = classifyViaError(cause);
        if (failure.kind === "signedOut") { failVia(slug, "signedOut"); return; }
        if (failure.kind === "refused") { failVia(slug, "refused", failure.message); return; }
        trouble = true;
        flowOf(slug, { step: "waiting", url, since, note: "trouble" });
      } finally {
        busy = false;
      }
      if (!alive) return;
      if (Date.now() - since >= VIA_DEADLINE_MS) { failVia(slug, trouble ? "offline" : "timeout"); return; }
      attempt += 1;
      timer = setTimeout(() => void tick(), viaDelay(attempt));
    };
    const onFocus = () => { if (document.visibilityState === "hidden") return; back = true; attempt = 0; void tick(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    timer = setTimeout(() => void tick(), viaDelay(0));
    viaPolls.current.set(slug, () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    });
  };

  // a reload or a restart mid sign-in: pick the wait up again once Composio Connect is known to be signed in
  useEffect(() => {
    if (!via?.signedIn) return;
    for (const [slug, entry] of Object.entries(readPendingVia())) {
      if (viaPolls.current.has(slug)) continue;
      flowOf(slug, { step: "waiting", url: entry.url, since: entry.since });
      pollVia(slug, entry.url, entry.since);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [via?.signedIn]);

  const connectVia = async (slug: string, launch: ConnectionPage) => {
    if (opening.current) { launch.cancel(); return; }
    opening.current = launch;
    setBusySlug(slug);
    setError(null);
    stopVia(slug);
    try {
      const answer = await askVia(slug, "POST");
      if (opening.current !== launch) return;
      if (answer.status === "connected") { await finishVia(slug); return; }
      if (answer.status === "failed") { failVia(slug, "refused", answer.message); return; }
      const url = answer.status === "started" ? mcpSignInLink(answer.url) : null;
      if (!url) { failVia(slug, "refused", t("connectors.invalidAuthorizationUrl")); return; }
      const since = Date.now();
      flowOf(slug, { step: "waiting", url, since });
      keepPendingVia(slug, { url, since });
      setKeyFor(null);
      const opened = await launch.open(url);
      pollVia(slug, url, since, launch.closed);
      if (!opened && opening.current === launch) setError({ key: "connectors.popupBlockedContinue" });
    } catch (cause) {
      if (opening.current !== launch) return;
      const failure = classifyViaError(cause);
      failVia(slug, failure.kind === "trouble" ? "offline" : failure.kind, failure.kind === "refused" ? failure.message : undefined);
    } finally {
      launch.cancel();
      if (opening.current === launch) {
        opening.current = null;
        setBusySlug(null);
      }
    }
  };

  const signInComposio = async (launch: ConnectionPage): Promise<boolean> => {
    try {
      const name = viaNow.current?.added ? viaNow.current.name ?? COMPOSIO_CONNECT_NAME : COMPOSIO_CONNECT_NAME;
      if (!viaNow.current?.added) {
        await api("/api/mcp/servers", { method: "POST", body: JSON.stringify({ name, type: "http", url: COMPOSIO_CONNECT_URL, enabled: false }) });
      }
      const result = await runMcpSignIn(name, { api, open: async (url) => { await launch.open(url); } });
      if (result.phase !== "succeeded") return false;
      await api(`/api/mcp/servers/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
      const next = await api("/api/connectors/composio-connect") as ComposioConnect;
      viaNow.current = next;
      setVia(next);
      return next.signedIn === true;
    } finally {
      launch.cancel();
    }
  };

  const authorizeComposio = async (slug: string) => {
    if (busySlug || opening.current || viaFlow[slug]?.step === "authorizing") return;
    // composio's page opens in the tab reserved on this click
    const launch = reserveConnectionPage();
    flowOf(slug, { step: "authorizing" });
    setError(null);
    let ok = false;
    try { ok = await signInComposio(launch); } catch { ok = false; }
    // step two waits for its own click: its page needs one, and the person sees the step they are on
    if (ok) flowOf(slug, null); else failVia(slug, "authorize");
  };

  const reopenVia = (slug: string) => {
    const flow = viaFlow[slug];
    if (flow?.step !== "waiting") { void connect(slug); return; }
    if (opening.current) return;
    const launch = reserveConnectionPage();
    void launch.open(flow.url).then((opened) => {
      if (!opened) setError({ key: "connectors.popupBlockedContinue" });
      else pollVia(slug, flow.url, flow.since, launch.closed);
    }).finally(() => launch.cancel());
  };

  const checkVia = (slug: string) => {
    if (!viaNow.current?.signedIn || viaFlow[slug] || viaPolls.current.has(slug)) return;
    void askVia(slug, "GET").then((answer) => {
      if (answer.status === "connected") { if (!viaApps[slug] || !viaNow.current?.enabled) void finishVia(slug); }
      else if (answer.status === "none" && viaApps[slug]) markVia(slug, false);
    }).catch(() => {});
  };

  const run = async (slug: string, launch: ConnectionPage, alias?: string, replacing?: ConnectorAccount) => {
    let viaNext = false;
    await runOnce(slug, launch, alias, replacing, () => { viaNext = true; });
    if (viaNext) await connectVia(slug, reserveConnectionPage());
  };

  const runOnce = async (slug: string, launch: ConnectionPage, alias: string | undefined, replacing: ConnectorAccount | undefined, goVia: () => void) => {
    let viaNext = false;
    opening.current = launch;
    generations.current.set(slug, (generations.current.get(slug) ?? 0) + 1);
    setBusySlug(slug);
    setError(null);
    try {
      const createdAt = Date.now();
      if (replacing) await api(`/api/connectors/${slug}/accounts/${encodeURIComponent(replacing.id)}`, { method: "DELETE" });
      const request: RequestInit = { method: "POST" };
      if (alias) request.body = JSON.stringify({ alias });
      const result = await api(`/api/connectors/${slug}/authorize`, request);
      if (opening.current !== launch) return;
      const url = mcpSignInLink(typeof result.url === "string" ? result.url : null);
      if (!url) throw new Error(t("connectors.invalidAuthorizationUrl"));
      setPendingUrls((current) => ({ ...current, [slug]: { url, createdAt } }));
      setStatus((current) => ({ ...current, [slug]: { ...current[slug], connected: current[slug]?.connected ?? false, pending: true, status: "INITIATED" } }));
      setAliasFor(null);
      setKeyFor(null);
      setSetupFor((current) => current === slug ? null : current);
      startPolling(slug, status[slug]);
      if (!await launch.open(url) && opening.current === launch) setError({ key: "connectors.popupBlockedContinue" });
    } catch (cause) {
      if (opening.current !== launch) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      if (needsComposioAuthConfig(message) && modeNow.current === "managed") {
        // the broker's project cannot sign in to it; Composio Connect, or the person's own key, can
        unmanaged.current.add(slug);
        if (viaNow.current?.signedIn) viaNext = true; else setKeyFor(slug);
      } else if (needsComposioAuthConfig(message)) {
        // no dead end: the tab reserved on the click opens where the person sets it up, and the page says so
        setSetupFor(slug);
        await launch.open(COMPOSIO_AUTH_CONFIGS_URL);
      } else if (requiresAccountAlias(message)) {
        setAliasFor(slug);
        setError({ key: "connectors.aliasNeeded" });
        void refreshStatus([slug]);
      } else {
        setError(accountAliasTaken(message) ? { key: "connectors.aliasTaken" } : message);
      }
    } finally {
      launch.cancel();
      if (opening.current === launch) {
        opening.current = null;
        setBusySlug(null);
      }
      if (viaNext) goVia();
    }
  };

  const resume = (slug: string) => {
    if (viaFlow[slug]) { reopenVia(slug); return; }
    const url = reusableConnectionUrl(pendingUrls[slug]);
    if (!url) { void connect(slug); return; }
    if (opening.current) return;
    const launch = reserveConnectionPage();
    opening.current = launch;
    setError(null);
    void launch.open(url)
      .then((opened) => { if (!opened && opening.current === launch) setError({ key: "connectors.popupBlockedContinue" }); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => {
        launch.cancel();
        if (opening.current === launch) opening.current = null;
      });
  };

  const continueAfterKey = async (slug: string, launch: ConnectionPage) => {
    if (busySlug || opening.current) { launch.cancel(); return; }
    opening.current = launch;
    setBusySlug(slug);
    let goOn = false;
    try {
      const [answer, inventory] = await Promise.all([reloadConnectorCatalog(), preloadConnectedApps(true)]);
      if (opening.current !== launch) return;
      setLive(answer.cards ?? []);
      setSource(answer.source);
      setConfigured(Boolean(answer.configured));
      setMode(answer.mode ?? "unavailable");
      modeNow.current = answer.mode ?? "unavailable";
      setSetup(answer.setup);
      setStale(!inventory.authoritative);
      setStatus((current) => ({ ...current, ...inventory.services }));
      setPhase("ready");
      setKeyFor(null);
      // the key's project may have the app connected already: then there is nothing to sign in to
      goOn = !hasActiveConnection(inventory.services[slug]);
    } catch (cause) {
      if (opening.current === launch) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (opening.current === launch && !goOn) {
        launch.cancel();
        opening.current = null;
        setBusySlug(null);
      }
    }
    if (goOn) await run(slug, launch);
  };

  const disconnect = (slug: string, accountId: string): Promise<boolean> => {
    setBusySlug(slug);
    return api(`/api/connectors/${slug}/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" })
      .then(() => refreshStatus([slug]).then(() => true))
      .catch(() => false)
      .finally(() => setBusySlug(null));
  };

  const phaseOf = (card: ToolkitCard, policyBlocked: string | null): ConnectorPhase => {
    const state = status[card.slug];
    const failed = Boolean(state?.status && /^(expired|failed)$/i.test(state.status));
    const pending = Boolean(state?.pending && !failed);
    const unavailable = policyBlocked ?? (managedConnectorUnavailableReason(mode, card.slug) ? t("connectors.selfHostOnlyReason") : null);
    if (unavailable) return { kind: "unavailable", reason: unavailable };
    if (card.noAuth === true || (state?.connected === true && !state.accounts?.length && !pending && !failed)) return { kind: "included" };
    if (busySlug === card.slug) return { kind: "connecting" };
    const flow = viaFlow[card.slug];
    if (flow?.step === "authorizing") return { kind: "connecting" };
    if (flow?.step === "waiting") return { kind: "continue", url: flow.url };
    if (flow?.step === "failed") return { kind: "failed", why: flow.why, ...(flow.message ? { message: flow.message } : {}) };
    if ((flow?.step === "done" || viaApps[card.slug]) && !hasActiveConnection(state)) return { kind: "connected" };
    if (phase === "loading") return { kind: "checking" };
    if (pending) return { kind: "continue", url: reusableConnectionUrl(pendingUrls[card.slug]) };
    const reconnect = accountToReconnect(state);
    if (reconnect) return { kind: "reconnect", account: reconnect };
    if (hasActiveConnection(state)) return { kind: "connected" };
    return setupFor === card.slug ? { kind: "setup" } : { kind: "connect" };
  };

  const ready = bundledSettled && liveSettled && cards !== null && (phase !== "loading" || Object.keys(status).length > 0);

  return {
    cards, ready, configured, mode, setup, stale, phase, status, error, aliasFor, setupFor, keyFor, via, viaApps, viaFlow,
    viaRoute: (slug) => !configured || unmanaged.current.has(slug) || keyFor === slug, authorizeComposio, reopenVia, checkVia,
    setError, askAlias: setAliasFor, askKey: setKeyFor, phaseOf,
    isConnected: (slug) => hasActiveConnection(status[slug]) || viaApps[slug] === true,
    connect, continueAfterKey, resume, disconnect,
    reload: () => setReloads((count) => count + 1),
  };
}
