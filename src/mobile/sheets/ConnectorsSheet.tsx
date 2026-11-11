import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { api } from "@/state/store";
import { connectorDescription } from "@/lib/app-catalog";
import { preloadConnectedApps } from "@/lib/connected-apps";
import { hasActiveConnection } from "@/lib/connector-status";
import { listLogins } from "@/lib/logins";
import { HOSTED_MCP_APPS, hostedConnections } from "@/lib/hosted-mcp-apps";
import { ServiceTile } from "@/components/ServiceIcon";
import { Icon } from "@/components/Icon";
import { type McpServerListing, isRemoteMcpListing } from "@/components/mcp-draft";
import { grokCategories, searchApps, type AppEntry } from "@/components/connect-apps/catalog";
import { mergeEntries, idsOf } from "@/components/connect-apps/merge";
import { appLogo } from "@/components/connect-apps/logos";
import { loadConnectorCatalog } from "@/components/connect-apps/use-connectors";
import { loadComposioSnapshot, mergeCatalog } from "@/components/connect-apps/composio-snapshot";
import { remoteConnection, sameEndpoint } from "@/components/connect-apps/use-remote-apps";
import { openConnectApps } from "@/components/connect-apps/open";
import { managedConnectorUnavailableReason } from "../../../shared/connector-availability";
import type { DirectoryAnswer } from "../../../shared/connector-directory";
import { Sheet } from "../Sheet";
import { haptic } from "../haptics";
import type { SheetPageProps } from "./registry";

interface AppsSnapshot { entries: AppEntry[]; added: Set<string>; incomplete: boolean }

export function appIsAdded(entry: AppEntry, added: ReadonlySet<string>): boolean {
  return idsOf(entry).some((id) => added.has(id));
}

function logoIcon(id: string, name: string, fallback: AppEntry["icon"] = {}): AppEntry["icon"] {
  const logo = appLogo(id, name);
  return logo ? { ...logo, image: logo.src } : fallback;
}

async function readApps(): Promise<AppsSnapshot> {
  const [catalog, inventory, directory, servers, logins, email, x, bundled] = await Promise.allSettled([
    loadConnectorCatalog(),
    preloadConnectedApps(true),
    api<DirectoryAnswer>("/api/connectors/directory"),
    api<{ servers: McpServerListing[] }>("/api/mcp/servers"),
    listLogins(),
    api<{ state: string }>("/api/email"),
    api<{ using: string | null }>("/api/x/status"),
    loadComposioSnapshot(),
  ]);
  const added = new Set<string>();
  const services = inventory.status === "fulfilled" ? inventory.value.services : {};
  for (const [id, status] of Object.entries(services)) if (hasActiveConnection(status)) added.add(id);
  if (logins.status === "fulfilled" && logins.value.onePassword?.connected) added.add("1password");
  if (email.status === "fulfilled" && email.value.state === "connected") added.add("email");
  if (x.status === "fulfilled" && x.value.using != null) added.add("x");
  const mcp = servers.status === "fulfilled" ? servers.value.servers.filter((server) => !server.bot) : [];
  for (const [id, connected] of Object.entries(hostedConnections(mcp))) if (connected) added.add(id);
  const own: AppEntry[] = [
    { id: "1password", kind: "logins", label: t("mobile.connectors.passwordName"), description: t("mobile.connectors.passwordDescription"), categories: ["credentials"], icon: logoIcon("1password", "1Password") },
    { id: "email", kind: "native", label: t("mobile.connectors.emailName"), description: t("mobile.connectors.emailDescription"), categories: ["communication"], icon: { glyph: "envelope" } },
    { id: "x", kind: "native", label: t("mobile.connectors.xName"), description: t("mobile.connectors.xDescription"), categories: ["marketing"], icon: logoIcon("x", "X") },
    { id: "custom-mcp", kind: "native", label: t("mobile.connectors.customName"), description: t("mobile.connectors.customDescription"), categories: ["code"], icon: { glyph: "plug" } },
    ...HOSTED_MCP_APPS.map((app): AppEntry => ({ id: app.id, kind: "hosted", label: app.label, description: t(app.id === "whop" ? "mobile.connectors.whopDescription" : "mobile.connectors.agentcardDescription"), categories: ["finance"], icon: "image" in app.icon ? { image: app.icon.image } : { glyph: "credit-card" } })),
  ];
  const mode = catalog.status === "fulfilled" ? catalog.value.mode ?? "unavailable" : "unavailable";
  const listed = mergeCatalog(catalog.status === "fulfilled" ? catalog.value.cards ?? [] : null, catalog.status === "fulfilled" ? catalog.value.source : undefined, bundled.status === "fulfilled" ? bundled.value : null) ?? [];
  const cards = listed.filter((card) => !managedConnectorUnavailableReason(mode, card.slug) || added.has(card.slug)).map((card): AppEntry => ({
    id: card.slug, kind: "composio", label: card.label, description: connectorDescription(card), categories: grokCategories(card.categories), website: card.domain ?? undefined,
    icon: logoIcon(card.slug, card.label, { logo: card.logo, padded: true }),
  }));
  const remote = directory.status === "fulfilled" ? directory.value.apps.filter((app) => app.source === "remote-mcp" && app.url) : [];
  const ownedServers = new Set<string>();
  for (const app of remote) {
    const matches = mcp.filter(isRemoteMcpListing).filter((server) => sameEndpoint(server.url, app.url!));
    for (const server of matches) ownedServers.add(server.name);
    if (matches.some((server) => remoteConnection(app, server) === "connected")) added.add(app.id);
  }
  const vendors = remote.map((app): AppEntry => ({ id: app.id, kind: "remote", label: app.label, description: app.description, categories: grokCategories(app.categories), website: app.domain ?? undefined, icon: logoIcon(app.id, app.label, { domain: app.domain }) }));
  const custom = mcp.filter((server) => !ownedServers.has(server.name) && !HOSTED_MCP_APPS.some((app) => server.name === app.id || server.name.startsWith(`${app.id}-`))).map((server): AppEntry => {
    const id = `mcp:${server.name}`;
    if (server.enabled) added.add(id);
    return { id, kind: "custom", label: server.name, description: t("mobile.connectors.serverDescription"), categories: ["code"], icon: { glyph: "server" } };
  });
  return {
    entries: [...mergeEntries([...own, ...cards, ...vendors]), ...custom], added,
    incomplete: [catalog, inventory, directory, servers, logins, email, x].some((answer) => answer.status === "rejected") || inventory.status === "fulfilled" && (!inventory.value.authoritative || inventory.value.refused === true) || directory.status === "fulfilled" && directory.value.providers.some((provider) => provider.available && !provider.ok),
  };
}

export function ConnectorsSheet({ open, onClose }: SheetPageProps<"connectors">) {
  const [snapshot, setSnapshot] = useState<AppsSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestVersion = useRef(0);
  const id = useId();
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(false);
    try {
      const next = await readApps();
      if (version === requestVersion.current) { setSnapshot(next); setError(next.incomplete); if (next.incomplete) haptic("error"); }
    } catch { if (version === requestVersion.current) { setError(true); haptic("error"); } }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, []);
  useEffect(() => { if (open) void load(); return () => { requestVersion.current++; }; }, [open, load]);
  const entries = snapshot ? query.trim() ? searchApps(snapshot.entries, query, snapshot.entries.length) : snapshot.entries : [];
  const groups = [{ key: "connected" as const, entries: entries.filter((entry) => snapshot && appIsAdded(entry, snapshot.added)) }, { key: "available" as const, entries: entries.filter((entry) => snapshot && !appIsAdded(entry, snapshot.added)) }];
  const connect = (entry: AppEntry) => { openConnectApps({ kind: "detail", id: entry.kind === "custom" ? "custom-mcp" : entry.id }); onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title={t("mobile.connectors.title")} full>
      <div className="px-3 pt-2">
        <label htmlFor={id} className="mx-3 mb-4 flex h-12 items-center gap-2 rounded-full bg-ink/[0.05] px-4 text-ink-secondary"><Search aria-hidden size={19} /><span className="sr-only">{t("mobile.connectors.search")}</span><input id={id} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("mobile.connectors.search")} className="h-full min-w-0 flex-1 border-0 bg-transparent text-[16px] text-ink placeholder:text-ink-tertiary" /></label>
        {error && <div className="px-3 pb-4"><p role="alert" className="text-[14px] text-danger">{t("mobile.connectors.error")}</p><button type="button" disabled={loading} onClick={() => void load()} className="mobile-press mt-2 min-h-11 rounded-full bg-ink/[0.05] px-5 text-[14px] font-semibold text-ink">{t("mobile.connectors.retry")}</button></div>}
        {loading ? <div role="status" aria-label={t("mobile.connectors.loading")}>{[0, 1, 2, 3, 4].map((key) => <div key={key} aria-hidden className="flex gap-3 px-3 py-4"><span className="size-[42px] rounded-[10px] bg-ink/[0.05]" /><span className="flex-1 space-y-2"><span className="block h-4 w-1/2 rounded-full bg-ink/[0.05]" /><span className="block h-3 w-3/4 rounded-full bg-ink/[0.05]" /></span></div>)}</div> : groups.map((group) => group.entries.length > 0 && <section key={group.key} aria-labelledby={`${id}-${group.key}`} className="mb-5"><h2 id={`${id}-${group.key}`} className="px-3 py-2 text-[13px] text-ink-tertiary">{t(`mobile.connectors.${group.key}`)}</h2><ul>{group.entries.map((entry) => {
          const added = appIsAdded(entry, snapshot!.added);
          const { glyph, glyphPaint: _glyphPaint, ...art } = entry.icon;
          return <li key={entry.id}><button type="button" onClick={() => connect(entry)} className="mobile-row flex min-h-[86px] w-full items-center gap-3 rounded-2xl px-3 py-3 text-left">
            <span aria-hidden className="flex size-[42px] shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-ink/[0.05] text-ink-secondary">{glyph ? <Icon name={glyph} size={23} /> : <ServiceTile card={{ label: entry.label, ...art }} size={42} />}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[16px] font-semibold text-ink">{entry.label}</span><span className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-ink-secondary">{entry.description}</span></span>
            <span className={cn("flex min-h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-semibold", added ? "bg-success/10 text-success" : "bg-ink/[0.06] text-ink")}>
              {added && <Check aria-hidden size={14} />}{t(added ? "mobile.connectors.added" : "mobile.connectors.add")}
            </span>
          </button></li>;
        })}</ul></section>)}
        {!loading && snapshot && entries.length === 0 && <p className="px-6 py-12 text-center text-[14px] text-ink-secondary">{t("mobile.connectors.noMatch")}</p>}
      </div>
    </Sheet>
  );
}
