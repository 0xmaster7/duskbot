import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { readCachedInventory } from "@/lib/connected-apps-cache";
import { connectorStatusMemory, preloadConnectedApps, rememberConnectorStatus } from "@/lib/connected-apps";
import { reserveConnectionPage, reusableConnectionUrl, type PendingAuthorization } from "@/lib/connector-oauth";
import { mcpSignInLink } from "@/lib/mcp-sign-in";
import { pollConnector } from "@/lib/connector-poll";
import { connectorConnect } from "@/lib/product-events";
import { lacksAdminScope } from "@/lib/admin-scope";
import { accountAliasTaken, accountToReconnect, hasActiveConnection, requiresAccountAlias, type ConnectorAccount, type ConnectorInventoryPhase, type ConnectorStatus } from "@/lib/connector-status";
import { mergeCompleteConnectorStatus, mergeCurrentConnectorStatus, onlyLatestConnectorResponses } from "@/lib/connector-status-merge";
import { managedConnectorUnavailableReason } from "../../../shared/connector-availability";
import type { ToolkitCard } from "../ServiceIcon";

export type ConnectorError = string | { key: LocaleKey } | null;
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
  | { kind: "unavailable"; reason: string };

export interface Connectors {
  cards: ToolkitCard[] | null;
  configured: boolean;
  mode: ConnectorMode;
  setup: "ready" | "needs-setup" | "service-unavailable" | undefined;
  stale: boolean;
  phase: ConnectorInventoryPhase;
  status: Record<string, ConnectorStatus>;
  error: ConnectorError;
  /** The app whose next Connect needs a name for the new account. */
  aliasFor: string | null;
  setError: (error: ConnectorError) => void;
  askAlias: (slug: string | null) => void;
  phaseOf: (card: ToolkitCard, policyBlocked: string | null) => ConnectorPhase;
  isConnected: (slug: string) => boolean;
  connect: (slug: string, alias?: string, replacing?: ConnectorAccount) => Promise<void>;
  resume: (slug: string) => void;
  disconnect: (slug: string, accountId: string) => void;
  reload: () => void;
}

/** The Composio catalog and its connections, with the same connect flow the Apps page has always run: reserve the tab on
 * the click, authorize, open the sign-in page, then poll until the account turns up. */
export function useConnectors(): Connectors {
  const [cards, setCards] = useState<ToolkitCard[] | null>(null);
  const [configured, setConfigured] = useState(false);
  const [mode, setMode] = useState<ConnectorMode>("unavailable");
  const [setup, setSetup] = useState<Connectors["setup"]>(undefined);
  const [status, setStatus] = useState<Record<string, ConnectorStatus>>(() => connectorStatusMemory()?.services ?? readCachedInventory()?.services ?? {});
  const [stale, setStale] = useState(connectorStatusMemory()?.authoritative === false);
  const [phase, setPhase] = useState<ConnectorInventoryPhase>(connectorStatusMemory() === null ? "loading" : "ready");
  const [pendingUrls, setPendingUrls] = useState<Record<string, PendingAuthorization>>({});
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [aliasFor, setAliasFor] = useState<string | null>(null);
  const [error, setError] = useState<ConnectorError>(null);
  const [reloads, setReloads] = useState(0);

  const polls = useRef(new Map<string, () => void>());
  const generations = useRef(new Map<string, number>());
  const latestRequests = useRef(new Map<string, number>());
  const opening = useRef<ReturnType<typeof reserveConnectionPage> | null>(null);

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
    api("/api/connectors/catalog")
      .then((response) => {
        if (!alive) return;
        setCards(response.cards ?? []);
        setConfigured(Boolean(response.configured));
        setMode(response.mode ?? "unavailable");
        setSetup(response.setup);
      })
      .catch((cause) => {
        if (!alive) return;
        setCards((current) => current ?? []);
        setError(lacksAdminScope(cause) ? { key: "connectors.adminOnly" } : cause.message);
      });
    return () => { alive = false; };
  }, [reloads]);

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

  const connect = async (slug: string, alias?: string, replacing?: ConnectorAccount) => {
    if (busySlug || opening.current) return;
    const launch = reserveConnectionPage();
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
      startPolling(slug, status[slug]);
      if (!await launch.open(url) && opening.current === launch) setError({ key: "connectors.popupBlockedContinue" });
    } catch (cause) {
      if (opening.current !== launch) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      if (requiresAccountAlias(message)) {
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
    }
  };

  const resume = (slug: string) => {
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

  const disconnect = (slug: string, accountId: string) => {
    setBusySlug(slug);
    api(`/api/connectors/${slug}/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" })
      .then(() => refreshStatus([slug]))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
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
    if (phase === "loading") return { kind: "checking" };
    if (pending) return { kind: "continue", url: reusableConnectionUrl(pendingUrls[card.slug]) };
    const reconnect = accountToReconnect(state);
    if (reconnect) return { kind: "reconnect", account: reconnect };
    if (hasActiveConnection(state)) return { kind: "connected" };
    return { kind: "connect" };
  };

  return {
    cards, configured, mode, setup, stale, phase, status, error, aliasFor,
    setError, askAlias: setAliasFor, phaseOf,
    isConnected: (slug) => hasActiveConnection(status[slug]),
    connect, resume, disconnect,
    reload: () => setReloads((count) => count + 1),
  };
}
