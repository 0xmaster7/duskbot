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

export type ConnectorError = string | { key: LocaleKey } | null;
/** Composio Connect, Composio's own MCP server, signed in with Composio's page: apps connect through it with no key. */
export interface ComposioConnect { added: boolean; name: string | null; signedIn: boolean; enabled: boolean }
export const COMPOSIO_CONNECT_NAME = "composio-connect";
export const COMPOSIO_CONNECT_URL = "https://connect.composio.dev/mcp";
const VIA_APPS = "omb.composioConnect.apps";
const VIA_POLL_MS = 8_000;
const VIA_POLL_TRIES = 15;
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
  /** Adds Composio Connect when it is missing, signs in on Composio's page in the tab reserved on the click, and turns it
   * on for bots. Resolves whether it is signed in. */
  signInComposio: (launch: ConnectionPage) => Promise<boolean>;
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
  const [viaPending, setViaPending] = useState<Record<string, string>>({});
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

  const markVia = (slug: string) => {
    setViaApps((current) => {
      const next: Record<string, true> = { ...current, [slug]: true };
      try { localStorage.setItem(VIA_APPS, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
    setViaPending((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== slug)));
    connectorConnect(slug, "connected");
  };

  const askVia = (slug: string) => api(`/api/connectors/composio-connect/apps/${encodeURIComponent(slug)}`, { method: "POST" }) as
    Promise<{ status: "connected" } | { status: "started"; url: string } | { status: "failed"; message: string }>;

  // composio's tool answers again on each check; it starts a link only while the app has no connection
  const pollVia = (slug: string) => {
    polls.current.get(slug)?.();
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      void askVia(slug).then((answer) => {
        if (polls.current.get(slug) !== stop) return;
        if (answer.status === "connected") { stop(); markVia(slug); } else if (tries >= VIA_POLL_TRIES) stop();
      }).catch(() => { if (tries >= VIA_POLL_TRIES) stop(); });
    }, VIA_POLL_MS);
    const stop = () => { clearInterval(timer); if (polls.current.get(slug) === stop) polls.current.delete(slug); };
    polls.current.set(slug, stop);
  };

  const connectVia = async (slug: string, launch: ConnectionPage) => {
    if (opening.current) { launch.cancel(); return; }
    opening.current = launch;
    setBusySlug(slug);
    setError(null);
    try {
      const answer = await askVia(slug);
      if (opening.current !== launch) return;
      if (answer.status === "connected") { markVia(slug); return; }
      if (answer.status === "failed") throw new Error(answer.message);
      const url = mcpSignInLink(answer.url);
      if (!url) throw new Error(t("connectors.invalidAuthorizationUrl"));
      setViaPending((current) => ({ ...current, [slug]: url }));
      setKeyFor(null);
      pollVia(slug);
      if (!await launch.open(url) && opening.current === launch) setError({ key: "connectors.popupBlockedContinue" });
    } catch (cause) {
      if (opening.current === launch) setError(cause instanceof Error ? cause.message : String(cause));
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
    const url = viaPending[slug] ?? reusableConnectionUrl(pendingUrls[slug]);
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
    if (viaApps[card.slug] && !hasActiveConnection(state)) return { kind: "connected" };
    if (viaPending[card.slug]) return { kind: "continue", url: viaPending[card.slug]! };
    if (phase === "loading") return { kind: "checking" };
    if (pending) return { kind: "continue", url: reusableConnectionUrl(pendingUrls[card.slug]) };
    const reconnect = accountToReconnect(state);
    if (reconnect) return { kind: "reconnect", account: reconnect };
    if (hasActiveConnection(state)) return { kind: "connected" };
    return setupFor === card.slug ? { kind: "setup" } : { kind: "connect" };
  };

  const ready = bundledSettled && liveSettled && cards !== null && (phase !== "loading" || Object.keys(status).length > 0);

  return {
    cards, ready, configured, mode, setup, stale, phase, status, error, aliasFor, setupFor, keyFor, via, viaApps, signInComposio,
    setError, askAlias: setAliasFor, askKey: setKeyFor, phaseOf,
    isConnected: (slug) => hasActiveConnection(status[slug]) || viaApps[slug] === true,
    connect, continueAfterKey, resume, disconnect,
    reload: () => setReloads((count) => count + 1),
  };
}
