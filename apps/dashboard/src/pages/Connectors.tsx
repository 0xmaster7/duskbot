import { useDeferredValue, useMemo, useState } from "react";
import { Check, ListFilter, Search, Sparkles } from "@/icons";
import type { WorkspaceSummary } from "../../../../shared/dashboard-protocol";
import { flowKey, useAppCommands, type AppFlow } from "../data/app-connect";
import { CATEGORY_NAMES, composioSlug, connectedIn, inCategory, presentCategories, searchApps, useConnectorRows, useDashApps, type Category, type ConnectorRow, type DashApp } from "../data/connectors";
import { cloudForWorkspace, useCloud } from "../data/cloud";
import { useSession } from "../data/session";
import { appLink, openApp } from "../lib/app-link";
import { toast } from "../lib/toast";
import { AppLogo } from "../ui/AppLogo";
import { Toggle } from "../ui/controls";
import { Button, cx, PageHeader, Skeleton } from "../ui/kit";
import { Pill, usePill } from "../ui/motion";
import { NameDot, Nil, RowMenu, SectionHead, Table, Td, Th, type MenuItem } from "../ui/table";

type Tab = "connectors" | "skills";
const PAGE = 8;
const CATALOG_PAGE = 30;

// the desktop app has no link that starts a sign-in, so the app opens and the toast says where to go
const openConnect = (app: { label: string }) => openApp(appLink.app, `opening dusk bot. connect ${app.label} from apps there.`);
const asleep = (ws: WorkspaceSummary | null) => ws !== null && (ws.freshness === "offline" || ws.freshness === "waiting");
const asleepLine = (ws: WorkspaceSummary, cloud: boolean) => cloud || ws.kind === "vps" ? `${ws.name} is asleep or not answering. wake it from clouds, then try again.` : `${ws.name} is asleep. connect from the dusk bot app on it, or use dusk cloud.`;

function ConnectAction({ app, flow, onConnect }: { app: DashApp; flow: AppFlow | undefined; onConnect(): void }) {
  if (flow?.phase === "waiting") return <Button size="sm" disabled aria-label={`connecting ${app.label}`}>connecting</Button>;
  if (flow?.phase === "sign-in" && flow.url) return <a className="text-link shrink-0 px-2 text-13" href={flow.url} target="_blank" rel="noopener noreferrer">finish sign-in</a>;
  return <Button size="sm" onClick={onConnect} aria-label={`connect ${app.label}`}>connect</Button>;
}

function Tile({ row }: { row: ConnectorRow }) {
  if (row.app) return <AppLogo app={row.app} size={32} />;
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-card-2 text-13 text-ink-2" aria-hidden>
      {row.type === "Skill" ? <Sparkles size={15} strokeWidth={1.5} /> : row.label.slice(0, 1).toUpperCase()}
    </span>
  );
}

function WorkspacesCell({ list }: { list: ConnectorRow["workspaces"] }) {
  const names = list.map((w) => w.name);
  return <span className="block max-w-[200px] truncate text-ink-2" title={names.join(", ")}>{names.length > 2 ? `${names.length} workspaces` : names.join(", ")}</span>;
}

function Row({ row, onAuth, menu }: { row: ConnectorRow; onAuth(): void; menu: MenuItem[] }) {
  const needs = row.status === "needs-auth";
  return (
    <tr className="hover-row">
      <Td>
        <div className="flex min-w-0 items-center gap-3">
          <Tile row={row} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{row.label}</span>
              <NameDot tone={needs ? "warn" : "good"} label={needs ? "needs sign-in" : "ready"} />
            </div>
            {needs
              ? <div className="truncate text-13 text-ink-3" aria-hidden>needs sign-in</div>
              : <div className="truncate text-13 text-ink-3 md:hidden"><span className="lowercase">{row.type}</span> · {row.workspaces.length === 1 ? row.workspaces[0]!.name : `${row.workspaces.length} workspaces`}</div>}
          </div>
        </div>
      </Td>
      <Td className="lowercase text-ink-2 max-md:hidden">{row.type}</Td>
      <Td className="lowercase text-ink-2 max-lg:hidden">{row.category}</Td>
      <Td className="num text-ink-2 max-lg:hidden">{row.tools ?? <Nil />}</Td>
      <Td className="lowercase text-ink-2 max-xl:hidden">{row.permissions ?? <Nil />}</Td>
      <Td className="max-md:hidden"><WorkspacesCell list={row.workspaces} /></Td>
      <Td className="w-0 !px-1 text-end">{needs && <Button variant="outline" size="sm" onClick={onAuth}>sign in</Button>}</Td>
      <Td className="w-0 !pe-1 !ps-0"><RowMenu label={`more for ${row.label}`} items={menu} /></Td>
    </tr>
  );
}

/** every app dusk bot can connect, searchable and by category */
function Catalog({ apps, connected, query, flowFor, onConnect }: { apps: DashApp[] | null; connected: string[]; query: string; onConnect(app: DashApp): void; flowFor(app: DashApp): AppFlow | undefined }) {
  const [category, setCategory] = useState<Category | null>(null);
  const pill = usePill();
  const [limit, setLimit] = useState(CATALOG_PAGE);
  const q = useDeferredValue(query.trim());
  const categories = useMemo(() => (apps ? presentCategories(apps) : []), [apps]);
  const list = useMemo(() => {
    if (!apps) return [];
    const pool = category ? inCategory(apps, category) : apps;
    return q ? searchApps(pool, q, 300) : pool;
  }, [apps, category, q]);
  const pick = (c: Category | null) => { setCategory(c); setLimit(CATALOG_PAGE); };
  return (
    <section className="mt-14" aria-labelledby="catalog-title">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="catalog-title" className="text-16 font-medium tracking-[-0.02em] text-ink">all apps</h2>
        <p className="num text-13 text-ink-3">{apps ? `${list.length.toLocaleString("en-US")} ${q || category ? "match" : "apps"}` : "loading"}</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="category">
        {[null, ...categories].map((c) => {
          const on = category === c;
          return (
            <button key={c ?? "all"} type="button" role="radio" aria-checked={on} onClick={() => pick(c)} className={cx("relative h-9 shrink-0 whitespace-nowrap rounded-full bg-card px-3.5 text-13 font-medium", on ? "text-primary-ink" : "hover-chip text-ink-2")}>
              {on && <Pill id={pill} className="bg-primary" />}
              <span className="relative">{c ? CATEGORY_NAMES[c].toLowerCase() : "all"}</span>
            </button>
          );
        })}
      </div>
      {apps === null ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-[72px] !rounded-row" />)}</div>
      ) : list.length ? (
        <>
          <ul className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {list.slice(0, limit).map((app) => {
              const added = connectedIn(app, connected);
              return (
                <li key={app.id} className="surface flex min-h-[72px] min-w-0 items-center gap-3 rounded-row bg-card px-3.5 py-3">
                  <AppLogo app={app} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-14 font-medium text-ink">{app.label}</div>
                    <div className="truncate text-13 text-ink-3">{app.description}</div>
                  </div>
                  {added
                    ? <span className="inline-flex shrink-0 items-center gap-1 px-2 text-13 text-ink-3"><Check size={14} strokeWidth={2} className="text-good" aria-hidden />added</span>
                    : <ConnectAction app={app} flow={flowFor(app)} onConnect={() => onConnect(app)} />}
                </li>
              );
            })}
          </ul>
          {list.length > limit && <button type="button" onClick={() => setLimit((n) => n + CATALOG_PAGE * 2)} className="hover-ghost -ms-4 mt-3 h-11 rounded-full px-4 text-14 text-ink-3">show more</button>}
        </>
      ) : <p className="mt-4 text-14 text-ink-3">no apps match "{q}". try another name.</p>}
    </section>
  );
}

export function ConnectorsPage() {
  const { workspaces, workspace } = useSession();
  const { connections, clouds } = useCloud();
  const { flows, connect, disconnect } = useAppCommands();
  const { apps } = useDashApps();
  const { rows, loading, error } = useConnectorRows();
  const [tab, setTab] = useState<Tab>("connectors");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [needsOnly, setNeedsOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const here = useMemo(() => (workspace ? connections?.[workspace.id] ?? [] : []), [connections, workspace]);
  const byId = useMemo(() => new Map((workspaces ?? []).map((w) => [w.id, w])), [workspaces]);
  const sleepy = (ws: WorkspaceSummary) => asleepLine(ws, cloudForWorkspace(clouds, ws.id) !== null);
  const start = (ws: WorkspaceSummary | null | undefined, app: { label: string }, slug: string | null) => {
    if (!ws || !slug) return openConnect(app);
    if (asleep(ws)) return toast(sleepy(ws), "bad");
    connect(ws, slug, app.label);
  };
  const rowSlug = (row: ConnectorRow) => (row.app ? composioSlug(row.app) : row.type === "Connector" ? row.id.toLowerCase() : null);
  const tabRows = rows.filter((r) => (tab === "skills" ? r.type === "Skill" : r.type !== "Skill"));
  const q = query.trim().toLowerCase();
  const shown = tabRows.filter((r) => (!q || r.label.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)) && (!category || r.category === category) && (!needsOnly || r.status === "needs-auth"));
  const categories = [...new Set(tabRows.map((r) => r.category))].sort();
  const filtered = Boolean(category) || needsOnly;

  const menuFor = (row: ConnectorRow): MenuItem[] => {
    const items: MenuItem[] = [{ label: "manage in the app", onSelect: () => openApp(appLink.app) }];
    if (row.type === "Skill") return items;
    const slug = rowSlug(row);
    for (const w of workspaces ?? []) if (!row.workspaces.some((x) => x.id === w.id)) items.push({ label: `add to ${w.name}`, onSelect: () => start(w, row, slug) });
    if (slug) for (const listed of row.workspaces) {
      const w = byId.get(listed.id);
      if (w) items.push({ label: `disconnect from ${w.name}`, danger: true, disabled: flows[flowKey(w.id, slug)]?.phase === "waiting", onSelect: () => asleep(w) ? toast(sleepy(w), "bad") : disconnect(w, slug, row.label) });
    }
    return items;
  };
  const switchTab = (v: Tab) => { setTab(v); setLimit(PAGE); setCategory(null); setNeedsOnly(false); };
  const apps_ = tab === "connectors";

  return (
    <div className="min-w-0">
      <PageHeader title="apps" sub={workspace ? `connect an app and your bots on ${workspace.name} can use it.` : "connect an app in the dusk bot app and your bots can use it."} />
      {asleep(workspace) && <p role="status" className="-mt-4 mb-6 text-14 text-ink-3">{sleepy(workspace!)}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Toggle<Tab> label="show" value={tab} onChange={switchTab} options={[{ value: "connectors", label: "apps" }, { value: "skills", label: "skills" }]} />
        <div className="flex min-w-0 items-center gap-2 max-sm:w-full">
          <div className="relative min-w-0 flex-1 sm:w-[300px]">
            <label className="sr-only" htmlFor="connector-search">search {apps_ ? "apps" : "skills"}</label>
            <Search size={16} strokeWidth={1.5} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
            <input id="connector-search" type="search" className="field !h-10 !rounded-full !pl-10" placeholder={apps_ ? (apps ? `search ${apps.length.toLocaleString("en-US")} apps` : "search apps") : "search skills"} value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} />
          </div>
          {tabRows.length > 0 && (
            <RowMenu
              label={filtered ? "filter, on" : "filter"}
              active={filtered}
              icon={<ListFilter size={17} strokeWidth={1.5} aria-hidden />}
              items={[
                { label: "every category", checked: !category, onSelect: () => { setCategory(null); setLimit(PAGE); } },
                ...categories.map((c) => ({ label: c.toLowerCase(), checked: category === c, onSelect: () => { setCategory(c); setLimit(PAGE); } })),
                ...(apps_ ? [{ label: needsOnly ? "show every status" : "needs sign-in only", onSelect: () => { setNeedsOnly((v) => !v); setLimit(PAGE); } }] : []),
              ]}
            />
          )}
        </div>
      </div>

      <section className="mt-10" aria-labelledby="installed-title">
        <SectionHead id="installed-title">{apps_ ? "connected" : "skills"}</SectionHead>
        {error ? (
          <div className="flex flex-wrap items-center gap-3 py-5"><p role="alert" className="text-14 text-bad">{error}</p><Button size="sm" onClick={() => location.reload()}>retry</Button></div>
        ) : loading ? (
          <div className="flex flex-col gap-2" aria-busy="true">{[0, 1].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : shown.length ? (
          <>
            <Table label={apps_ ? "connected apps" : "skills"} className="max-sm:[&_table]:table-fixed max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
              <thead>
                <tr>
                  <Th>name</Th>
                  <Th className="max-md:hidden">type</Th>
                  <Th className="max-lg:hidden">category</Th>
                  <Th className="max-lg:hidden">tools on</Th>
                  <Th className="max-xl:hidden">permissions</Th>
                  <Th className="max-md:hidden">workspaces</Th>
                  <Th className="w-0 max-sm:w-[88px]"><span className="sr-only">sign in</span></Th>
                  <Th className="w-0 max-sm:w-12"><span className="sr-only">more</span></Th>
                </tr>
              </thead>
              <tbody>{shown.slice(0, limit).map((row) => <Row key={row.id} row={row} menu={menuFor(row)} onAuth={() => start(byId.get(row.workspaces[0]?.id ?? "") ?? workspace, row, rowSlug(row))} />)}</tbody>
            </Table>
            {shown.length > limit && <button type="button" onClick={() => setLimit((n) => n + PAGE * 2)} className="hover-ghost -ms-4 mt-2 h-11 rounded-full px-4 text-14 text-ink-3">show more</button>}
          </>
        ) : (
          <p className="py-6 text-15 text-ink-2">{q || filtered ? `nothing connected matches${q ? ` "${query.trim()}"` : " that filter"}.` : apps_ ? "nothing connected yet. pick an app below to connect it." : "no skills yet. ask a bot in a chat to learn one."}</p>
        )}
        {!apps_ && !loading && <p className="mt-4 text-14 text-ink-4">skills ship with the app and work on every workspace.</p>}
      </section>

      {apps_ && <Catalog apps={apps} connected={here} query={query} onConnect={(app) => start(workspace, app, composioSlug(app))}
        flowFor={(app) => { const slug = composioSlug(app); return workspace && slug ? flows[flowKey(workspace.id, slug)] : undefined; }} />}
    </div>
  );
}
