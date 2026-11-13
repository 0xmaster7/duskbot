import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/state/store";
import { openExternalLink } from "@/lib/app-links";
import { runMcpSignIn } from "@/lib/mcp-sign-in";
import { updateMcpServers } from "@/lib/mcp-servers";
import { t } from "@/lib/i18n";
import { whenServerHas } from "@/lib/server-compat";
import type { DirectoryAnswer, DirectoryApp } from "../../../shared/connector-directory";
import { isRemoteMcpListing, type McpServerListing, type RemoteMcpListing } from "../mcp-draft";
import type { Connection } from "./catalog";
import { VIA_DEADLINE_MS, watchReturn } from "./via-flow";

let directory: Promise<DirectoryApp[]> | null = null;
// kept across opens, so the window's first frame already has them
let directoryApps: DirectoryApp[] | null = null;
let directoryFailed = false;
let serverList: McpServerListing[] | null = null;

/** The vendors' own MCP servers the directory kept, read once per session. */
function loadRemoteApps(): Promise<DirectoryApp[]> {
  directory ??= whenServerHas("connectorDirectory", () => api("/api/connectors/directory") as Promise<DirectoryAnswer>)
    .then((answer) => (directoryApps = (answer?.apps ?? []).filter((app) => app.source === "remote-mcp" && typeof app.url === "string")))
    .catch((cause) => { directory = null; directoryFailed = true; throw cause; });
  return directory;
}

/** Reads the directory and the MCP servers ahead of the window, for its first frame. */
export function prefetchRemoteApps(): Promise<unknown> {
  return Promise.allSettled([
    loadRemoteApps(),
    serverList ? null : api("/api/mcp/servers").then((answer) => { serverList ??= answer.servers ?? []; }),
  ]);
}

/** The same endpoint: origin and path, a trailing slash either way. */
export function sameEndpoint(a: string, b: string): boolean {
  try {
    const left = new URL(a), right = new URL(b);
    const path = (url: URL) => url.pathname.replace(/\/+$/, "");
    return left.origin === right.origin && path(left) === path(right) && !left.search && !left.hash;
  } catch {
    return false;
  }
}

/** `linear`, then `linear-2`…: never an existing server's name. */
export function freeServerName(id: string, servers: ReadonlyArray<{ name: string }>): string {
  const names = new Set(servers.map((server) => server.name));
  let name = id;
  for (let suffix = 2; names.has(name); suffix++) name = `${id}-${suffix}`;
  return name;
}

export function remoteConnection(app: DirectoryApp, server: RemoteMcpListing | undefined): Connection {
  if (!server?.enabled) return "disconnected";
  return app.auth === "none" || server.auth === "signed-in" ? "connected" : "disconnected";
}

/** A turned-on entry whose sign-in is one to redo: it was signed in (an entry is turned on only once it is) and the
 * app refused it since, expired or revoked. Signing in again keeps its name, so every bot keeps its access. */
export function needsReconnect(app: DirectoryApp, server: RemoteMcpListing): boolean {
  return app.auth === "oauth" && server.enabled && server.auth === "needs-sign-in";
}

/** One of the app's entries, as its page lists it. */
export interface RemoteAccount {
  name: string;
  account?: string;
  signedIn: boolean;
  stale: boolean;
}

export interface RemoteApps {
  apps: DirectoryApp[];
  /** The directory and the servers have answered (or failed): the list will not grow on its own any more. */
  settled: boolean;
  /** Apps signing in right now, each on its own: one slow sign-in never holds another row. */
  busy: Record<string, true>;
  error: string | null;
  clearError: () => void;
  connection: (id: string) => Connection;
  /** Each entry the app has, the first one added first. */
  accounts: (id: string) => RemoteAccount[];
  /** The app's entry to sign in to again, when none of its entries works any more. */
  toReconnect: (id: string) => RemoteAccount | undefined;
  /** True when this MCP server is one of these apps, so Your apps lists it once. */
  ownsServer: (name: string) => boolean;
  /** Signs in: `server` again to that entry, `account` to a new entry of its own named so, else to the app's entry. */
  connect: (app: DirectoryApp, target?: { server?: string; account?: string }) => Promise<void>;
  /** Stops the app's sign-in where it is and puts its row back to Connect. */
  cancel: (id: string) => void;
}

/** Adds the vendor's server and signs in with the person's own account, the same flow as Add MCP server's Sign in.
 * `needsPanel`: a remote browser pastes the callback back, which only the MCP servers page can take. */
export function useRemoteApps(options: { needsPanel: () => boolean; openPanel: () => void }): RemoteApps {
  const [apps, setApps] = useState<DirectoryApp[]>(() => directoryApps ?? []);
  const [appsSettled, setAppsSettled] = useState(() => directoryApps !== null);
  const [servers, setServersNow] = useState<McpServerListing[] | null>(() => serverList);
  const setServers = useCallback((next: McpServerListing[]) => { serverList = next; setServersNow(next); }, []);
  const [busy, setBusy] = useState<Record<string, true>>({});
  const [error, setError] = useState<string | null>(null);
  const signIns = useRef(new Map<string, AbortController>());
  const latest = useRef(options);
  latest.current = options;

  const listed = useCallback((next: McpServerListing[] | undefined) => {
    setServers(next ?? []);
    updateMcpServers(next ?? []);
    return next ?? [];
  }, [setServers]);
  const reload = useCallback(() => api("/api/mcp/servers").then((answer) => listed(answer.servers)), [listed]);

  useEffect(() => {
    let alive = true;
    loadRemoteApps().then((list) => { if (alive) setApps(list); }).catch(() => {}).finally(() => { if (alive) setAppsSettled(true); });
    api("/api/mcp/servers").then((answer) => { if (alive) setServers(answer.servers ?? []); }).catch(() => { if (alive) setServers([]); });
    const running = signIns.current;
    return () => { alive = false; for (const controller of running.values()) controller.abort(); running.clear(); };
  }, [setServers]);

  const serversOf = (app: DirectoryApp) => (servers ?? []).filter((server): server is RemoteMcpListing =>
    isRemoteMcpListing(server) && server.type === "http" && sameEndpoint(server.url, app.url!));
  // the entry that answers for the app: one that works, else the first
  const serverOf = (app: DirectoryApp) => {
    const all = serversOf(app);
    return all.find((server) => remoteConnection(app, server) === "connected") ?? all[0];
  };

  const mark = (id: string, on: boolean) => setBusy((current) => {
    const next: Record<string, true> = { ...current };
    if (on) next[id] = true; else delete next[id];
    return next;
  });

  const connect = async (app: DirectoryApp, target: { server?: string; account?: string } = {}) => {
    if (signIns.current.has(app.id)) return;
    const controller = new AbortController();
    signIns.current.set(app.id, controller);
    mark(app.id, true);
    setError(null);
    // left unfinished (back here a while, or past the link's life): it ends with a line to retry, never a spinner
    let gaveUp = false;
    const giveUp = () => { gaveUp = true; controller.abort(); };
    const unwatch = watchReturn(() => {}, giveUp);
    const deadline = setTimeout(giveUp, VIA_DEADLINE_MS);
    try {
      let server = target.account ? undefined : target.server ? serversOf(app).find((one) => one.name === target.server) : serverOf(app);
      const name = server?.name ?? freeServerName(app.id, servers ?? []);
      if (!server) {
        const account = target.account?.trim().slice(0, 64);
        const added = listed((await api("/api/mcp/servers", { method: "POST", body: JSON.stringify({ name, type: "http", url: app.url, enabled: app.auth === "none", ...(account ? { account } : {}) }) })).servers);
        server = added.find((entry): entry is RemoteMcpListing => entry.name === name && isRemoteMcpListing(entry));
        if (!server) throw new Error(t("hostedMcp.setupFailed", { service: app.label }));
      }
      if (app.auth === "oauth" && server.auth !== "signed-in") {
        if (latest.current.needsPanel()) { latest.current.openPanel(); return; }
        const result = await runMcpSignIn(name, { api, open: openExternalLink, signal: controller.signal });
        if (gaveUp) throw new Error(t("mcp.auth.failed"));
        if (result.phase === "cancelled" || controller.signal.aborted) return;
        if (result.phase !== "succeeded") throw new Error(result.message || t("mcp.auth.failed"));
      }
      if (!server.enabled || app.auth === "oauth") listed((await api(`/api/mcp/servers/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) })).servers);
    } catch (cause) {
      if (!controller.signal.aborted || gaveUp) setError(cause instanceof Error ? cause.message : String(cause));
      void reload().catch(() => {});
    } finally {
      unwatch();
      clearTimeout(deadline);
      if (signIns.current.get(app.id) === controller) {
        signIns.current.delete(app.id);
        mark(app.id, false);
      }
    }
  };

  const cancel = (id: string) => {
    signIns.current.get(id)?.abort();
    signIns.current.delete(id);
    mark(id, false);
  };

  const byId = new Map(apps.map((app) => [app.id, app]));
  return {
    apps, busy, error,
    settled: (appsSettled || directoryFailed) && servers !== null,
    clearError: () => setError(null),
    connection: (id) => { const app = byId.get(id); return app && servers ? remoteConnection(app, serverOf(app)) : "unknown"; },
    accounts: (id) => {
      const app = byId.get(id);
      return app ? serversOf(app).map((server) => ({
        name: server.name, ...(server.account ? { account: server.account } : {}),
        signedIn: remoteConnection(app, server) === "connected", stale: needsReconnect(app, server),
      })) : [];
    },
    toReconnect: (id) => {
      const app = byId.get(id);
      if (!app || !servers || remoteConnection(app, serverOf(app)) === "connected") return undefined;
      const stale = serversOf(app).find((server) => needsReconnect(app, server));
      return stale ? { name: stale.name, ...(stale.account ? { account: stale.account } : {}), signedIn: false, stale: true } : undefined;
    },
    ownsServer: (name) => apps.some((app) => serversOf(app).some((server) => server.name === name)),
    connect,
    cancel,
  };
}
