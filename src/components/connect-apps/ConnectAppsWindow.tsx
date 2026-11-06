import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import { useStore, type Action } from "@/state/store";
import { t } from "@/lib/i18n";
import { connectorDescription } from "@/lib/app-catalog";
import { listLogins } from "@/lib/logins";
import { connectorStatusMemory, preloadConnectedApps } from "@/lib/connected-apps";
import { loadMcpServers, type McpServerSummary } from "@/lib/mcp-servers";
import { POSTIZ_SERVER } from "../../../shared/postiz";
import { HOSTED_MCP_APPS, type HostedConnections, type HostedMcpAppId } from "@/lib/hosted-mcp-apps";
import { managedConnectorUnavailableReason } from "../../../shared/connector-availability";
import { hasActiveConnection } from "@/lib/connector-status";
import type { SkillsLibrarySkillWire } from "../../../shared/wire";
import { GrokIcon } from "../GrokIcon";
import { GrokMark } from "../mascot-motion-view";
import { AppsSection } from "../AppsSection";
import { McpServersPanel } from "../McpServersPanel";
import { XCard } from "../XCard";
import { EmailCard } from "../EmailCard";
import { HighLevelCard } from "../HighLevelCard";
import { PostizCard } from "../PostizCard";
import { openKeySettings } from "../keys/key-focus";
import { botsUsingService } from "../PluginsPanel";
import { AppRow, AppTile, GlyphTile, type RowAction } from "./AppRow";
import { AppFacts, AppPage, appFacts, type AppPageModel } from "./AppPage";
import { OnePasswordBody } from "./OnePasswordBody";
import type { OnePasswordStatus } from "../../../shared/logins";
import { CategoryMenu } from "./CategoryMenu";
import {
  CATEGORY_LABEL, INLINE_CHIPS, SECTION_SIZE, fromCatalog, grokCategories, inCategory, matchRank, presentCategories, recommended, searchApps,
  type AppEntry, type Category, type Connection,
} from "./catalog";
import { MCP_SERVERS_ID as MCP_PAGE, type ConnectAppsPage } from "./open";
import { cachedConnectorCatalog, loadConnectorCatalog, useConnectors, type ConnectorPhase } from "./use-connectors";
import { appLogo } from "./logos";
import { composioLogo, loadComposioSnapshot, snapshotToolkit } from "./composio-snapshot";
import { useRemoteApps } from "./use-remote-apps";
import { directoryKey, type DirectoryApp } from "../../../shared/connector-directory";
import type { ToolkitCard } from "../ServiceIcon";
import "./connect-apps.css";

type NativeId = "x" | "email" | "highlevel" | "postiz";
const NATIVE_IDS: readonly NativeId[] = ["email", "x", "highlevel", "postiz"];
const RECOMMENDED = "recommended";
// a category holds hundreds of Composio apps: rows arrive a page at a time as the list nears its end
const ROWS_PAGE = 60;
const SETTINGS = (section: "logins" | "skills"): Action => ({ type: "toggleAppSettings", open: true, section });

function logoIcon(...names: string[]): AppEntry["icon"] {
  const logo = appLogo(...names);
  return logo ? { image: logo.src, padded: logo.padded, background: logo.background, scale: logo.scale } : {};
}

/** Grok's logo when it has one, then the catalog's own mark, then Composio's mark for the slug: never a favicon. */
function cardIcon(card: ToolkitCard): AppEntry["icon"] {
  const known = logoIcon(card.slug, card.label);
  if (known.image) return known;
  return { logo: card.logo ?? composioLogo(card.slug), padded: true };
}

/** Our bundled logo when we have one, else the vendor site's own icon through /api/site-icon. */
function remoteIcon(app: DirectoryApp): AppEntry["icon"] {
  const known = logoIcon(app.id, app.label);
  return known.image ? known : { domain: app.domain };
}

const keysOf = (...names: string[]) => names.map(directoryKey);

function nativeEntries(): AppEntry[] {
  return [
    { id: "1password", kind: "logins", label: "1Password", description: t("connectApps.onePassword.description"), categories: ["credentials"], icon: logoIcon("1password"), website: "1password.com", keywords: "password vault logins" },
    { id: "email", kind: "native", label: t("email.title"), description: t("email.description"), categories: ["communication"], icon: { glyph: "envelope", glyphPaint: "rgb(229 47 139)" }, keywords: "email mail imap smtp mailbox" },
    { id: "x", kind: "native", label: t("apps.x.title"), description: t("apps.x.description"), categories: ["marketing"], icon: logoIcon("x"), website: "x.com", keywords: "x twitter posts" },
    { id: "highlevel", kind: "native", label: t("highlevel.title"), description: t("highlevel.description"), categories: ["sales"], icon: logoIcon("highlevel"), website: "gohighlevel.com", keywords: "highlevel high level growably crm" },
    { id: "postiz", kind: "native", label: "Postiz", description: t("postiz.description"), categories: ["marketing"], icon: logoIcon("postiz"), website: "postiz.com", keywords: "postiz social media posts schedule" },
    ...HOSTED_MCP_APPS.map((app): AppEntry => ({
      id: app.id, kind: "hosted", label: app.label, description: t(app.description), categories: ["finance"],
      icon: "image" in app.icon ? { image: app.icon.image } : { glyph: "credit-card", glyphPaint: "rgb(48 49 54)" }, website: new URL(app.url).hostname.replace(/^mcp\./, ""), keywords: app.keywords,
    })),
  ];
}

function decodeImage(src: string): Promise<void> {
  const image = new Image();
  image.src = src;
  return image.decode().catch(() => {});
}

/** What the window's first frame shows, read ahead: the catalog, what is connected and every bundled logo, so it opens
 * complete instead of filling in. */
export function prepareConnectApps(): Promise<void> {
  const logos = (cards: readonly ToolkitCard[]) => Promise.all([...nativeEntries().map((entry) => entry.icon), ...cards.map(cardIcon)]
    .flatMap((icon) => (icon.image ? [decodeImage(icon.image)] : [])));
  const catalog = cachedConnectorCatalog();
  return Promise.allSettled([
    catalog ? logos(catalog.cards ?? []) : loadConnectorCatalog().then((answer) => logos(answer.cards ?? [])),
    connectorStatusMemory() ? null : preloadConnectedApps(),
    loadComposioSnapshot(),
  ]).then(() => {});
}

interface Toast { kind: "success" | "error"; text: string }

export function ConnectAppsWindow({ page: requested, nonce, onClose, onTemplates }: {
  page: ConnectAppsPage;
  nonce: number;
  onClose: () => void;
  onTemplates: () => void;
}) {
  const { state, dispatch } = useStore();
  const connectors = useConnectors();
  const remote = useRemoteApps({
    needsPanel: () => window.ogb?.remoteClient?.active === true,
    openPanel: () => go({ kind: "detail", id: MCP_PAGE }),
  });
  const [page, setPage] = useState<ConnectAppsPage>(requested);
  const [trail, setTrail] = useState<ConnectAppsPage[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([]);
  const [query, setQuery] = useState("");
  const [resultsOpen, setResultsOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [natives, setNatives] = useState<Record<NativeId, boolean | null>>({ x: null, email: null, highlevel: null, postiz: null });
  const [hosted, setHosted] = useState<HostedConnections | null>(null);
  const [onePassword, setOnePassword] = useState<OnePasswordStatus | null>(null);
  const [skills, setSkills] = useState<SkillsLibrarySkillWire[] | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [rowLimit, setRowLimit] = useState(ROWS_PAGE);
  const moreRows = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const thumb = useScrollThumb(scroller, `${page.kind}:${"id" in page ? page.id : "category" in page ? page.category : ""}`);

  useEffect(() => { setPage(requested); setTrail([]); }, [requested, nonce]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    setScrolled(false);
    setRowLimit(ROWS_PAGE);
    if (dialog.current && !dialog.current.contains(document.activeElement)) dialog.current.focus({ preventScroll: true });
  }, [page]);

  useEffect(() => {
    let alive = true;
    listLogins().then((answer) => { if (alive) setOnePassword(answer.onePassword ?? { connected: false }); }).catch(() => { if (alive) setOnePassword(null); });
    void loadMcpServers().then((servers) => { if (alive) setMcpServers(servers); });
    fetch("/api/skills-library")
      .then(async (response) => (response.ok ? ((await response.json()) as { skills?: SkillsLibrarySkillWire[] }).skills ?? [] : []))
      .then((list) => { if (alive) setSkills(list); })
      .catch(() => { if (alive) setSkills([]); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const target = moreRows.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((seen) => {
      if (seen.some((entry) => entry.isIntersecting)) setRowLimit((limit) => limit + ROWS_PAGE);
    }, { root: scroller.current, rootMargin: "0px 0px 800px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [page, rowLimit]);

  const policy = state.config?.managedPolicy;
  const blocked = useCallback((slug: string) => policy?.apps && !policy.apps.allowAll && !policy.apps.allowlist.includes(slug)
    ? t("policy.managedBy", { organization: policy.organizationName }) : null, [policy]);

  const cards = useMemo(() => new Map((connectors.cards ?? []).map((card) => [card.slug, card])), [connectors.cards]);
  const entries = useMemo<AppEntry[]>(() => {
    const own = nativeEntries();
    const taken = new Set(own.flatMap((entry) => keysOf(entry.id, entry.label)));
    const vendorKeys = new Set(remote.apps.flatMap((app) => keysOf(app.id, app.label)));
    // without composio set up its list is a placeholder that cannot connect, so a vendor's own server takes its row
    const catalog = (connectors.cards ?? [])
      .filter((card) => !managedConnectorUnavailableReason(connectors.mode, card.slug) || hasActiveConnection(connectors.status[card.slug]))
      .filter((card) => connectors.configured || hasActiveConnection(connectors.status[card.slug]) || !keysOf(card.slug, card.label).some((key) => vendorKeys.has(key)))
      .map((card): AppEntry => ({
        id: card.slug, kind: "composio", label: card.label, description: connectorDescription(card), categories: grokCategories(card.categories),
        icon: cardIcon(card), website: card.domain ?? undefined, keywords: card.slug,
      }));
    for (const entry of catalog) for (const key of keysOf(entry.id, entry.label)) taken.add(key);
    const vendors = remote.apps
      .filter((app) => !keysOf(app.id, app.label).some((key) => taken.has(key)))
      .map((app): AppEntry => ({
        id: app.id, kind: "remote", label: app.label, description: app.description, categories: grokCategories(app.categories),
        icon: remoteIcon(app), website: app.domain ?? undefined, keywords: `${app.id} mcp`,
      }));
    return [...own, ...catalog, ...vendors];
  }, [connectors.cards, connectors.configured, connectors.mode, connectors.status, remote.apps]);
  const remoteApps = useMemo(() => new Map(remote.apps.map((app) => [app.id, app])), [remote.apps]);
  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);

  const connection = useCallback((id: string): Connection => {
    const entry = byId.get(id);
    if (!entry) return "unknown";
    const known = (value: boolean | null | undefined): Connection => value == null ? "unknown" : value ? "connected" : "disconnected";
    if (entry.kind === "composio") return connectors.isConnected(id) ? "connected" : "disconnected";
    if (entry.kind === "remote") return remote.connection(id);
    if (entry.kind === "logins") return known(onePassword?.connected);
    if (entry.kind === "hosted") return known(hosted?.[id as HostedMcpAppId]);
    return known(natives[id as NativeId]);
  }, [byId, connectors, hosted, natives, onePassword, remote]);

  const connected = entries.filter((entry) => connection(entry.id) === "connected");
  const known = useRef(new Map<string, Connection>());
  useEffect(() => {
    let added: AppEntry | undefined;
    for (const entry of entries) {
      if (entry.kind === "composio" && connectors.phase !== "ready") continue;
      const now = connection(entry.id);
      if (now === "connected" && known.current.get(entry.id) === "disconnected") added ??= entry;
      if (now !== "unknown") known.current.set(entry.id, now);
    }
    if (added) setToast({ kind: "success", text: t("connectApps.added", { name: added.label }) });
  }, [entries, connection, connectors.phase]);
  useEffect(() => {
    if (!connectors.error) return;
    const text = typeof connectors.error === "string" ? connectors.error : t(connectors.error.key);
    if (connectors.aliasFor) return;
    setToast({ kind: "error", text });
  }, [connectors.error, connectors.aliasFor]);
  useEffect(() => {
    if (!remote.error) return;
    setToast({ kind: "error", text: remote.error });
    remote.clearError();
  }, [remote]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5_000);
    return () => clearTimeout(timer);
  }, [toast]);

  const go = (next: ConnectAppsPage) => {
    setResultsOpen(false);
    setActive(-1);
    setTrail((past) => next.kind === "detail" || next.kind === "yours" ? [...past, page] : []);
    setPage(next);
  };
  const back = () => {
    setPage(trail.at(-1) ?? { kind: "home" });
    setTrail((past) => past.slice(0, -1));
  };
  const leaveFor = (action: Action) => { onClose(); dispatch(action); };

  const phaseOf = (entry: AppEntry): ConnectorPhase | null => {
    const card = cards.get(entry.id);
    return entry.kind === "composio" && card ? connectors.phaseOf(card, blocked(card.slug)) : null;
  };
  const startConnect = (entry: AppEntry) => {
    const vendor = entry.kind === "remote" ? remoteApps.get(entry.id) : undefined;
    if (vendor) return void remote.connect(vendor);
    if (entry.kind !== "composio" || !connectors.configured) return go({ kind: "detail", id: entry.id });
    void connectors.connect(entry.id);
  };
  const rowAction = (entry: AppEntry): RowAction => {
    if (connection(entry.id) === "connected" && entry.kind !== "composio") return { kind: "connected" };
    const phase = phaseOf(entry);
    const connect: RowAction = { kind: "button", label: t("connectors.action.connect"), onClick: () => startConnect(entry) };
    if (entry.kind === "remote") return { ...connect, busy: remote.busy === entry.id };
    if (!phase) return connect;
    switch (phase.kind) {
      case "connected": case "included": return { kind: "connected" };
      case "connecting": return { ...connect, busy: true };
      case "continue": return { ...connect, pending: true, title: t("connectors.finishSetup"), onClick: () => connectors.resume(entry.id) };
      case "reconnect": return { kind: "button", label: t("connectors.action.reconnect"), onClick: () => void connectors.connect(entry.id, phase.account.alias, phase.account) };
      case "unavailable": return { ...connect, disabled: true, title: phase.reason };
      default: return connect;
    }
  };
  // grok's rows always say what the app does, under its name
  const row = (entry: AppEntry) => (
    <AppRow key={entry.id} entry={entry} subtitle={entry.description} action={rowAction(entry)} onOpen={() => go({ kind: "detail", id: entry.id })} />
  );

  const categories = presentCategories(entries);
  const inline = categories.slice(0, INLINE_CHIPS);
  const more = categories.slice(INLINE_CHIPS);
  const selected = page.kind === "category" ? page.category : null;
  const label = (category: Category) => t(CATEGORY_LABEL[category]);

  const trimmed = query.trim();
  const appHits = trimmed ? searchApps(entries, trimmed) : [];
  const nearMatch = (text: string) => (matchRank(text, trimmed) ?? 3) < 3;
  const skillHits = trimmed ? (skills ?? []).filter((skill) => nearMatch(skill.name) || nearMatch(skill.description)).slice(0, 4) : [];
  const categoryHits = trimmed ? categories.filter((category) => nearMatch(label(category))) : [];
  const options: Array<{ key: string; pick: () => void }> = [
    ...appHits.map((entry) => ({ key: `app:${entry.id}`, pick: () => { setQuery(""); go({ kind: "detail", id: entry.id }); } })),
    ...skillHits.map((skill) => ({ key: `skill:${skill.name}`, pick: () => leaveFor(SETTINGS("skills")) })),
    ...categoryHits.map((category) => ({ key: `category:${category}`, pick: () => { setQuery(""); go({ kind: "category", category }); } })),
  ];
  const showResults = resultsOpen && trimmed.length > 0;

  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && showResults) {
      event.preventDefault();
      event.stopPropagation();
      setResultsOpen(false);
      setActive(-1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length) return;
      event.preventDefault();
      setResultsOpen(true);
      setActive((index) => event.key === "ArrowDown" ? (index + 1) % options.length : index <= 0 ? options.length - 1 : index - 1);
    } else if (event.key === "Enter" && showResults && options.length) {
      event.preventDefault();
      options[Math.max(0, active)]!.pick();
    }
  };

  const onDialogKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || menuOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const at = document.activeElement;
    if (event.shiftKey && (at === first || at === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && at === last) { event.preventDefault(); first.focus(); }
  };

  const nativeCardsShown = page.kind === "detail" && (NATIVE_IDS as readonly string[]).includes(page.id) ? page.id : null;
  const hostedShown = page.kind === "detail" && HOSTED_MCP_APPS.some((app) => app.id === page.id) ? page.id : null;
  const onePasswordShown = page.kind === "detail" && page.id === "1password";
  const setNative = useCallback((id: NativeId) => (value: boolean | null) => setNatives((current) => current[id] === value ? current : { ...current, [id]: value }), []);
  const nativeSetters = useMemo(() => Object.fromEntries(NATIVE_IDS.map((id) => [id, setNative(id)])) as Record<NativeId, (value: boolean | null) => void>, [setNative]);

  const detailEntry = page.kind === "detail" ? byId.get(page.id) : undefined;
  const sub = page.kind === "detail" || page.kind === "yours";

  const body = (() => {
    if (page.kind === "detail" && page.id === MCP_PAGE) {
      return (
        <div className="ca-detail">
          <div className="ca-detail-header">
            <GlyphTile name="server" size={56} />
            <h3 className="ca-detail-name" data-detail-hero-title="">{t("connectApps.mcp")}</h3>
          </div>
          <McpServersPanel embedded hideHosted />
        </div>
      );
    }
    if (page.kind === "detail") {
      if (!detailEntry) return connectors.cards === null ? <p className="ca-loading">{t("connectors.loadingCatalog")}</p> : null;
      const card = cards.get(detailEntry.id);
      const model: AppPageModel = {
        entry: detailEntry,
        connection: connection(detailEntry.id),
        phase: phaseOf(detailEntry),
        card,
        connectors,
        categoryLabel: detailEntry.categories[0] ? label(detailEntry.categories[0]) : null,
        usedBy: card && connection(detailEntry.id) === "connected" ? botsUsingService(state.bots, state.instances, card.slug).map((bot) => bot.name) : [],
        ...(detailEntry.kind === "composio" ? { toolkit: snapshotToolkit(detailEntry.id) } : {}),
        remoteClient: window.ogb?.remoteClient?.active === true,
        onOpenLogins: () => leaveFor(SETTINGS("logins")),
        onOpenKeys: () => leaveFor(openKeySettings("composio")),
        ...(detailEntry.kind === "remote" && remoteApps.get(detailEntry.id) ? { remote: {
          open: remoteApps.get(detailEntry.id)!.auth === "none",
          busy: remote.busy === detailEntry.id,
          onConnect: () => void remote.connect(remoteApps.get(detailEntry.id)!),
          onManage: () => go({ kind: "detail", id: MCP_PAGE }),
        } } : {}),
      };
      return <AppPage model={model} />;
    }
    if (page.kind === "yours") {
      const servers = mcpServers.filter((server) => server.name !== POSTIZ_SERVER && !remote.ownsServer(server.name) && !HOSTED_MCP_APPS.some((app) => server.name === app.id || server.name.startsWith(`${app.id}-`)));
      const serverEntry = (name: string): AppEntry => ({ id: `mcp:${name}`, kind: "native", label: name, description: t("connectApps.mcpServer"), categories: [], icon: { glyph: "server" } });
      return (
        <div className="ca-yours @container">
          <h1 className="ca-title ps-2" data-detail-hero-title="">{t("connectApps.manage")}</h1>
            <Group title={t("connectApps.installed")}>
              {connected.length || servers.length
                ? <div className="grid grid-cols-1 gap-x-2 gap-y-0.5 @xl:grid-cols-2">
                  {connected.map((entry) => (
                    <AppRow key={entry.id} entry={entry} subtitle={entry.description} action={{ kind: "status", label: t("apps.connected"), tone: "connected" }} onOpen={() => go({ kind: "detail", id: entry.id })} />
                  ))}
                  {servers.map((server) => (
                    <AppRow key={server.name} entry={serverEntry(server.name)} subtitle={t("connectApps.mcpServer")}
                      action={server.enabled ? { kind: "status", label: t("apps.connected"), tone: "connected" } : { kind: "status", label: t("connectApps.off"), tone: "quiet" }}
                      onOpen={() => go({ kind: "detail", id: MCP_PAGE })} />
                  ))}
                </div>
                : <p className="ca-note">{t("connectApps.nothingInstalled")}</p>}
            </Group>
            <Group title={t("connectApps.mcp")}>
              <div className="grid grid-cols-1 gap-x-2 gap-y-0.5 @xl:grid-cols-2">
                <AppRow entry={{ id: MCP_PAGE, kind: "native", label: t("apps.mcp.add"), description: t("mcp.subtitle"), categories: [], icon: { glyph: "plus" } }}
                  subtitle={t("connectApps.mcpAdd")} action={{ kind: "none" }} onOpen={() => go({ kind: "detail", id: MCP_PAGE })} />
              </div>
            </Group>
            <Group title={t("connectApps.skills")}>
              {skills?.length
                ? <div className="grid grid-cols-1 gap-x-2 gap-y-0.5 @xl:grid-cols-2">{skills.map((skill) => (
                  <AppRow key={skill.name} entry={{ id: `skill:${skill.name}`, kind: "native", label: skill.name, description: skill.description, categories: [], icon: { glyph: "file-list" } }}
                    subtitle={skill.description || t("connectApps.skill.subtitle")} action={{ kind: "none" }} onOpen={() => leaveFor(SETTINGS("skills"))} />
                ))}</div>
                : <p className="ca-note">{t("connectApps.noSkills")}</p>}
            </Group>
        </div>
      );
    }
    const sections: Array<{ key: string; title: string; entries: AppEntry[]; viewAll?: () => void; growing?: boolean }> = [];
    const picks = recommended(entries.filter(fromCatalog), connection, Infinity);
    if (page.kind === "category") {
      sections.push(page.category === RECOMMENDED
        ? { key: RECOMMENDED, title: t("connectApps.recommended"), entries: picks, growing: true }
        : { key: page.category, title: label(page.category as Category), entries: inCategory(entries, page.category), growing: true });
    } else {
      if (picks.length) sections.push({ key: RECOMMENDED, title: t("connectApps.recommended"), entries: picks.slice(0, SECTION_SIZE), viewAll: picks.length > SECTION_SIZE ? () => go({ kind: "category", category: RECOMMENDED }) : undefined });
      for (const category of categories) {
        const members = inCategory(entries, category);
        sections.push({ key: category, title: label(category), entries: members.slice(0, SECTION_SIZE), viewAll: members.length > SECTION_SIZE ? () => go({ kind: "category", category }) : undefined });
      }
    }
    return (
      <div className="ca-sections @container">
        {connectors.cards === null && <p className="ca-loading">{t("connectors.loadingCatalog")}</p>}
        {sections.map((section) => {
          const growing = section.growing && typeof IntersectionObserver !== "undefined" && section.entries.length > rowLimit;
          return (
            <AppsSection key={section.key} id={`ca-section-${section.key}`} title={section.title}
              viewAll={section.viewAll ? { label: t("apps.viewAll"), onClick: section.viewAll } : undefined}
              after={growing ? <div ref={moreRows} aria-hidden="true" className="h-px" /> : undefined}>
              {(growing ? section.entries.slice(0, rowLimit) : section.entries).map((entry) => row(entry))}
            </AppsSection>
          );
        })}
      </div>
    );
  })();

  return (
    <div className="ca-scrim" data-connect-apps="" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialog} data-tour="apps-panel" role="dialog" aria-modal="true" aria-label={t("connectApps.title")} tabIndex={-1} className="ca-dialog" onKeyDown={onDialogKey}>
        <div className="ca-layout">
          <button type="button" data-tour="apps-close" className="ca-icon-button ca-close" aria-label={t("connectApps.close")} onClick={onClose}>
            <GrokIcon name="close" size={16} />
          </button>
          <div className="ca-bar" data-sub={sub ? "" : undefined}>
            {page.kind === "detail" && (
              <button type="button" className="ca-icon-button" aria-label={t("connectApps.back")} onClick={back}>
                <GrokIcon name="chevron-left" size={16} />
              </button>
            )}
            {page.kind === "yours" && (
              <button type="button" className="ca-back-text" onClick={back}>
                <span aria-hidden="true"><GrokIcon name="chevron-left" size={16} /></span>
                <span>{t("connectApps.title")}</span>
              </button>
            )}
            {sub && (
              <h3 aria-hidden="true" className="ca-bar-title" data-shown={scrolled ? "" : undefined}>
                {page.kind === "yours" ? t("connectApps.manage") : page.id === MCP_PAGE ? t("connectApps.mcp") : detailEntry?.label}
              </h3>
            )}
          </div>
          <div className="ca-body">
            <div ref={scroller} className="ca-scroll" onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 40)}>
              <div className="ca-pane">
                {!sub && (
                  <div className="ca-home">
                    <div className="ca-head">
                      <h2 className="ca-title" id="ca-title">{t("connectApps.title")}</h2>
                      <button type="button" className="ca-installed" aria-label={t("connectApps.yours")} onClick={() => go({ kind: "yours" })}>
                        {connected.length > 0 && (
                          <span className="ca-stack" aria-hidden="true">
                            {connected.slice(0, 4).map((entry) => <span key={entry.id}><AppTile entry={entry} size={18} /></span>)}
                          </span>
                        )}
                        <span>{t("apps.connectedCount", { count: connected.length })}</span>
                        <span data-chevron="" aria-hidden="true" className="inline-flex"><GrokIcon name="chevron-right" size={12} /></span>
                      </button>
                    </div>
                    <div className="ca-controls">
                      <div className="ca-search-row">
                        <div className="ca-search">
                          <div className="ca-field" data-filled={query ? "" : undefined}>
                            <GrokIcon name="search" size={14} />
                            <input
                              ref={input}
                              type="text"
                              role="combobox"
                              aria-label={t("connectApps.search")}
                              aria-autocomplete="list"
                              aria-expanded={showResults}
                              aria-controls="ca-results"
                              aria-activedescendant={showResults && active >= 0 ? `ca-option-${active}` : undefined}
                              placeholder={t("connectApps.search")}
                              spellCheck={false}
                              value={query}
                              onChange={(event) => { setQuery(event.target.value); setResultsOpen(true); setActive(-1); }}
                              onFocus={() => setResultsOpen(true)}
                              onBlur={(event) => { if (!event.currentTarget.parentElement?.parentElement?.contains(event.relatedTarget as Node)) setResultsOpen(false); }}
                              onKeyDown={onSearchKey}
                            />
                            {query && (
                              <button type="button" className="ca-clear" onClick={() => { setQuery(""); setActive(-1); input.current?.focus(); }}>
                                {t("connectApps.clear")}
                              </button>
                            )}
                          </div>
                          {showResults && (
                            <div className="ca-results" onMouseDown={(event) => event.preventDefault()}>
                              <div id="ca-results" role="listbox" aria-label={t("connectApps.search")}>
                                {options.length === 0 && <p className="ca-empty">{t("connectApps.noResults", { query: trimmed })}</p>}
                                <ResultGroup label={t("connectApps.results.apps")} show={appHits.length > 0}>
                                  {appHits.map((entry, index) => (
                                    <Option key={entry.id} index={index} active={active} onHover={setActive} onPick={options[index]!.pick} icon={<AppTile entry={entry} size={24} />} label={entry.label} />
                                  ))}
                                </ResultGroup>
                                <ResultGroup label={t("connectApps.results.skills")} show={skillHits.length > 0}>
                                  {skillHits.map((skill, offset) => {
                                    const index = appHits.length + offset;
                                    return <Option key={skill.name} index={index} active={active} onHover={setActive} onPick={options[index]!.pick} icon={<span className="ca-option-glyph"><GrokIcon name="file-list" size={12} /></span>} label={skill.name} />;
                                  })}
                                </ResultGroup>
                                <ResultGroup label={t("connectApps.results.categories")} show={categoryHits.length > 0}>
                                  {categoryHits.map((category, offset) => {
                                    const index = appHits.length + skillHits.length + offset;
                                    return <Option key={category} index={index} active={active} onHover={setActive} onPick={options[index]!.pick} label={label(category)} />;
                                  })}
                                </ResultGroup>
                              </div>
                            </div>
                          )}
                        </div>
                        <button type="button" className="ca-templates" data-bot-templates-link="" onClick={onTemplates}>
                          <GrokMark body="blob" ink="var(--ca-mark)" size={18} animated={false} />
                          {t("connectApps.templates")}
                          <span data-arrow="" aria-hidden="true"><GrokIcon name="arrow-right-up" size={12} /></span>
                        </button>
                      </div>
                      <div className="ca-chips" role="group" aria-label={t("connectApps.categoriesAria")} data-marketplace-chips="">
                        <button type="button" className="ca-chip" aria-pressed={selected === null} onClick={() => go({ kind: "home" })}>{t("apps.filter.all")}</button>
                        {inline.map((category) => (
                          <button key={category} type="button" className="ca-chip" aria-pressed={selected === category}
                            onClick={() => go(selected === category ? { kind: "home" } : { kind: "category", category })}>
                            {label(category)}
                          </button>
                        ))}
                        {more.length > 0 && (
                          <CategoryMenu
                            label={selected && (more as string[]).includes(selected) ? label(selected as Category) : t("apps.more")}
                            ariaLabel={t("apps.moreCategories")}
                            choices={more.map((category) => ({ key: category, label: label(category) }))}
                            selected={selected}
                            onPick={(category) => go({ kind: "category", category })}
                            onOpenChange={setMenuOpen}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {body}
                <div className={nativeCardsShown || hostedShown || onePasswordShown ? "ca-native-host" : "hidden"} data-native-host="">
                  <div className={hostedShown ? "contents" : "hidden"}>
                    <McpServersPanel hostedCards={{ shown: (id) => id === hostedShown, onConnections: setHosted }} />
                  </div>
                  <div className={nativeCardsShown === "x" ? "contents" : "hidden"}><XCard onConnection={nativeSetters.x} /></div>
                  <div className={nativeCardsShown === "email" ? "contents" : "hidden"}><EmailCard onConnection={nativeSetters.email} /></div>
                  <div className={nativeCardsShown === "highlevel" ? "contents" : "hidden"}><HighLevelCard onConnection={nativeSetters.highlevel} /></div>
                  <div className={nativeCardsShown === "postiz" ? "contents" : "hidden"}><PostizCard onConnection={nativeSetters.postiz} /></div>
                  {onePasswordShown && <OnePasswordBody status={onePassword} onChange={setOnePassword} onManage={() => leaveFor(SETTINGS("logins"))} />}
                </div>
                {detailEntry && detailEntry.kind !== "composio" && (
                  <div className="ca-native-facts">
                    <AppFacts facts={appFacts({ entry: detailEntry, categoryLabel: detailEntry.categories[0] ? label(detailEntry.categories[0]) : null, usedBy: [] })} />
                  </div>
                )}
              </div>
            </div>
            {thumb && (
              <div role="presentation" className="ca-scrollbar" data-scrolling={thumb.scrolling ? "" : undefined}>
                <div style={{ top: thumb.top, height: thumb.height }} />
              </div>
            )}
          </div>
          {toast && (
            <div className="ca-toast" role="status" aria-live="polite" data-kind={toast.kind}>
              <GrokIcon name={toast.kind === "success" ? "check" : "exclamation-circle"} size={13} />
              <span>{toast.text}</span>
              <button type="button" aria-label={t("connectApps.dismiss")} onClick={() => setToast(null)}><GrokIcon name="close" size={12} /></button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h3 className="ca-group-title">{title}</h3>
      {children}
    </section>
  );
}

function ResultGroup({ label, show, children }: { label: string; show: boolean; children: ReactNode }) {
  if (!show) return null;
  return (
    <div role="group" aria-label={label}>
      <div className="ca-results-label" aria-hidden="true">{label}</div>
      {children}
    </div>
  );
}

function Option({ index, active, onHover, onPick, icon, label }: {
  index: number;
  active: number;
  onHover: (index: number) => void;
  onPick: () => void;
  icon?: ReactNode;
  label: string;
}) {
  return (
    <button type="button" role="option" id={`ca-option-${index}`} tabIndex={-1} aria-selected={index === active} className="ca-option"
      onMouseMove={() => { if (index !== active) onHover(index); }} onClick={onPick}>
      {icon}
      <span>{label}</span>
      <GrokIcon name="chevron-right" size={12} />
    </button>
  );
}

function useScrollThumb(scroller: React.RefObject<HTMLDivElement | null>, key: string) {
  const [thumb, setThumb] = useState<{ top: number; height: number; scrolling: boolean } | null>(null);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = (scrolling: boolean) => {
      const { scrollHeight, clientHeight, scrollTop } = element;
      if (scrollHeight <= clientHeight + 1) { setThumb(null); return; }
      const track = clientHeight - 6;
      const height = Math.max(20, (clientHeight / scrollHeight) * track);
      setThumb({ top: (scrollTop / (scrollHeight - clientHeight)) * (track - height), height, scrolling });
    };
    const onScroll = () => {
      measure(true);
      clearTimeout(timer);
      timer = setTimeout(() => measure(false), 800);
    };
    measure(false);
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure(false));
    observer?.observe(element);
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    return () => {
      clearTimeout(timer);
      element.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [scroller, key]);
  return thumb;
}

