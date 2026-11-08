import { useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { popularity } from "@/components/connect-apps/catalog";
import { connectedIn, searchApps, useConnectorRows, useDashApps, type ConnectorRow, type DashApp } from "../data/connectors";
import { useCloud } from "../data/cloud";
import { useSession } from "../data/session";
import { APP_LINK } from "../lib/usage";
import { AppLogo } from "../ui/AppLogo";
import { Modal, Select, Toggle } from "../ui/controls";
import { Button, PageHeader, Skeleton } from "../ui/kit";
import { NameDot, RowMenu, SectionHead, Table, Td, Th, type MenuItem } from "../ui/table";

type Tab = "connectors" | "skills";
const PAGE = 8;

function openConnect(app: { id: string; label: string }, workspaceId: string, toast: (t: string) => void) {
  toast(`Opening OpenMausBot to connect ${app.label}`);
  window.location.assign(`${APP_LINK}connect/${encodeURIComponent(app.id)}?workspace=${encodeURIComponent(workspaceId)}`);
}

function Tile({ row }: { row: ConnectorRow }) {
  if (row.app) return <AppLogo app={row.app} size={32} />;
  return (
    <span className="flex shrink-0 items-center text-13 text-ink-3" aria-hidden>
      {row.type === "Skill" ? <Sparkles size={16} strokeWidth={1.5} /> : row.label.slice(0, 1).toUpperCase()}
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
    <tr className="hover-row transition-colors duration-150">
      <Td>
        <div className="flex min-w-0 items-center gap-3">
          <Tile row={row} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{row.label}</span>
              <NameDot tone={needs ? "warn" : "good"} label={needs ? "Needs sign-in" : "Ready"} />
            </div>
            {needs
              ? <div className="truncate text-13 text-ink-3" aria-hidden>Needs sign-in</div>
              : <div className="truncate text-13 text-ink-3 md:hidden">{row.type} · {row.workspaces.length === 1 ? row.workspaces[0]!.name : `${row.workspaces.length} workspaces`}</div>}
          </div>
        </div>
      </Td>
      <Td className="text-ink-2 max-md:hidden">{row.type}</Td>
      <Td className="max-md:hidden"><WorkspacesCell list={row.workspaces} /></Td>
      <Td className="w-0 !px-1 text-end">{needs && <Button variant="outline" size="sm" onClick={onAuth}>Sign in</Button>}</Td>
      <Td className="w-0 !pe-1 !ps-0"><RowMenu label={`More for ${row.label}`} items={menu} /></Td>
    </tr>
  );
}

function AddDialog({ open, onClose, apps, connections }: { open: boolean; onClose(): void; apps: DashApp[] | null; connections: Record<string, string[]> }) {
  const { workspaces, workspace, toast } = useSession();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState("");
  const where = target || workspace?.id || workspaces?.[0]?.id || "";
  const connected = connections[where] ?? [];
  const results = apps ? (query.trim() ? searchApps(apps, query, 40) : apps.filter((a) => Number.isFinite(popularity(a))).slice(0, 12)) : [];
  return (
    <Modal open={open} onClose={onClose} title="Add a connector" wide>
      <p>Pick an app. OpenMausBot opens on that workspace to sign in, then your bots can use it.</p>
      <div className="mt-5 flex flex-col gap-3">
        {workspaces && workspaces.length > 1 && (
          <div>
            <label htmlFor="add-workspace" className="mb-1.5 block text-13 text-ink-2">Workspace</label>
            <Select id="add-workspace" value={where} onChange={(e) => setTarget(e.target.value)}>{workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
          </div>
        )}
        <div className="relative">
          <label className="sr-only" htmlFor="add-search">Search apps</label>
          <Search size={16} strokeWidth={1.5} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
          <input id="add-search" type="search" className="field !pl-10" placeholder={apps ? `Search ${apps.length.toLocaleString("en-US")} apps` : "Search apps"} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <ul className="-mx-2 mt-3 max-h-[44vh] overflow-y-auto">
        {apps === null ? <li className="p-2"><Skeleton className="h-12" /></li> : results.length ? results.map((app) => (
          <li key={app.id} className="flex items-center gap-3 border-b border-line px-2 py-3">
            <AppLogo app={app} size={32} />
            <div className="min-w-0 flex-1"><div className="truncate text-14 text-ink">{app.label}</div><div className="truncate text-13 text-ink-3">{app.description}</div></div>
            {connectedIn(app, connected) ? <span className="px-2 text-13 text-ink-3">Added</span> : <Button size="sm" disabled={!where} onClick={() => openConnect(app, where, toast)} aria-label={`Add ${app.label}`}>Add</Button>}
          </li>
        )) : <li className="px-2 py-4 text-14 text-ink-3">No apps match "{query.trim()}". Try another name.</li>}
      </ul>
    </Modal>
  );
}

export function ConnectorsPage() {
  const { workspaces, workspace, toast } = useSession();
  const { connections } = useCloud();
  const { apps } = useDashApps();
  const { rows, loading, error } = useConnectorRows();
  const [tab, setTab] = useState<Tab>("connectors");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [suggested, setSuggested] = useState(6);
  const [adding, setAdding] = useState(false);

  const all = useMemo(() => [...new Set(Object.values(connections ?? {}).flat())], [connections]);
  const tabRows = rows.filter((r) => (tab === "skills" ? r.type === "Skill" : r.type !== "Skill"));
  const q = query.trim().toLowerCase();
  const shown = tabRows.filter((r) => (!q || r.label.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)));
  const picks = apps ? apps.filter((a) => Number.isFinite(popularity(a)) && !connectedIn(a, all) && (!q || a.label.toLowerCase().includes(q))).slice(0, 24) : [];
  const home = workspace?.id ?? workspaces?.[0]?.id ?? "";

  const menuFor = (row: ConnectorRow): MenuItem[] => {
    const items: MenuItem[] = [{ label: "Manage in the app", onSelect: () => window.location.assign(APP_LINK) }];
    if (row.type !== "Skill") for (const w of workspaces ?? []) if (!row.workspaces.some((x) => x.id === w.id)) items.push({ label: `Add to ${w.name}`, onSelect: () => openConnect({ id: row.app?.id ?? row.id, label: row.label }, w.id, toast) });
    return items;
  };
  const authWorkspace = (row: ConnectorRow) => (row.workspaces.some((w) => w.id === home) ? home : row.workspaces[0]?.id ?? home);
  const switchTab = (v: Tab) => { setTab(v); setLimit(PAGE); };

  return (
    <div className="min-w-0">
      <PageHeader title="Connectors" sub="Apps your bots can use. Each workspace keeps its own sign-ins." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Toggle<Tab> label="Show" value={tab} onChange={switchTab} options={[{ value: "connectors", label: "Connectors" }, { value: "skills", label: "Skills" }]} />
        <div className="flex min-w-0 items-center gap-2 max-sm:w-full">
          <div className="relative min-w-0 flex-1 sm:w-[280px]">
            <label className="sr-only" htmlFor="connector-search">Search {tab}</label>
            <Search size={16} strokeWidth={1.5} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
            <input id="connector-search" type="search" className="field !h-10 !rounded-full !pl-10" placeholder={tab === "skills" ? "Search skills" : "Search connectors"} value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} />
          </div>
          <Button variant="primary" onClick={() => (tab === "skills" ? window.location.assign(APP_LINK) : setAdding(true))}>Add</Button>
        </div>
      </div>

      <section className="enter mt-10" aria-labelledby="installed-title">
        <SectionHead id="installed-title">{tab === "skills" ? "Skills" : "Connectors and MCPs"}</SectionHead>
        {error ? (
          <div className="flex flex-wrap items-center gap-3 border-y border-line py-5"><p role="alert" className="text-14 text-bad">{error}</p><Button size="sm" onClick={() => location.reload()}>Retry</Button></div>
        ) : loading ? (
          <div className="flex flex-col gap-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : shown.length ? (
          <>
            <Table label={tab === "skills" ? "Skills" : "Connectors and MCPs"} className="max-sm:[&_table]:table-fixed max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th className="max-md:hidden">Type</Th>
                  <Th className="max-md:hidden">Workspaces</Th>
                  <Th className="w-0 max-sm:w-[88px]"><span className="sr-only">Sign in</span></Th>
                  <Th className="w-0 max-sm:w-12"><span className="sr-only">More</span></Th>
                </tr>
              </thead>
              <tbody>{shown.slice(0, limit).map((row) => <Row key={row.id} row={row} menu={menuFor(row)} onAuth={() => openConnect({ id: row.app?.id ?? row.id, label: row.label }, authWorkspace(row), toast)} />)}</tbody>
            </Table>
            {shown.length > limit && <button type="button" onClick={() => setLimit((n) => n + PAGE * 2)} className="press-soft hover-ghost mt-2 h-11 rounded-full px-4 text-14 text-ink-3">Show more</button>}
          </>
        ) : (
          <div className="border-y border-line py-8">
            <p className="text-14 text-ink-2">{q ? `Nothing here matches "${query.trim()}".` : tab === "skills" ? "No skills yet." : "Nothing connected yet."}</p>
            <p className="mt-1 text-14 text-ink-3">{q ? "Clear the search to see everything." : tab === "skills" ? "Ask a bot in a chat to learn a skill, or add one in the app." : "Add an app and your bots can use it right away."}</p>
          </div>
        )}
        {tab === "skills" && !loading && <p className="mt-4 text-14 text-ink-4">Skills ship with the app and work on every workspace. Bots can also write their own in a chat.</p>}
      </section>

      {tab === "connectors" && (
        <section className="enter mt-14" style={{ ["--i" as string]: 1 }} aria-labelledby="suggested-title">
          <SectionHead id="suggested-title">Suggested</SectionHead>
          {apps === null ? (
            <div className="grid gap-x-10 gap-y-2 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : picks.length ? (
            <>
              <ul className="grid gap-x-10 md:grid-cols-2">
                {picks.slice(0, suggested).map((app) => (
                  <li key={app.id} className="flex min-h-[76px] min-w-0 items-center gap-4 border-b border-line py-3">
                    <AppLogo app={app} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-14 font-medium text-ink">{app.label}</div>
                      <div className="truncate text-14 text-ink-3">{app.description}</div>
                    </div>
                    <Button variant="outline" size="sm" disabled={!home} onClick={() => openConnect(app, home, toast)} aria-label={`Add ${app.label}`}>Add</Button>
                  </li>
                ))}
              </ul>
              {picks.length > suggested && <button type="button" onClick={() => setSuggested((n) => n + 8)} className="press-soft hover-ghost mt-2 h-11 rounded-full px-4 text-14 text-ink-3">Show more</button>}
            </>
          ) : <p className="text-14 text-ink-3">{q ? "No suggestions match. Use Add to search every app." : "You have connected every popular app."}</p>}
        </section>
      )}

      <AddDialog open={adding} onClose={() => setAdding(false)} apps={apps} connections={connections ?? {}} />
    </div>
  );
}
