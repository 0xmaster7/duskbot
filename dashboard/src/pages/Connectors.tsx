import { useState } from "react";
import { Check, Search } from "lucide-react";
import { popularity } from "@/components/connect-apps/catalog";
import { cloudForWorkspace, useCloud } from "../data/cloud";
import { CATEGORY_NAMES, connectedIn, inCategory, presentCategories, searchApps, useDashApps, type Category, type DashApp } from "../data/connectors";
import { useSession } from "../data/session";
import { APP_LINK } from "../lib/usage";
import { AppLogo } from "../ui/AppLogo";
import { Toggle } from "../ui/controls";
import { Badge, Button, ButtonLink, Card, cx, PageHeader, SectionTitle, Skeleton } from "../ui/kit";

export function ConnectorsPage() {
  const { workspaces, workspace, pick, toast } = useSession();
  const { clouds, connections, error: cloudError } = useCloud();
  const { apps, error } = useDashApps();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "popular">("popular");
  const [limit, setLimit] = useState(24);
  const connected = connections?.[workspace?.id ?? ""] ?? [];
  const linked = apps?.filter((app) => connectedIn(app, connected)) ?? [];
  const results = apps ? query.trim() ? searchApps(apps, query, 60) : category === "popular" ? apps.filter((app) => Number.isFinite(popularity(app))).sort((a, b) => popularity(a) - popularity(b)) : inCategory(apps, category) : [];
  const connect = (app: DashApp) => {
    if (!workspace) return;
    toast(`Opening OpenMausBot to connect ${app.label}`);
    window.location.assign(`${APP_LINK}connect/${encodeURIComponent(app.id)}?workspace=${encodeURIComponent(workspace.id)}`);
  };
  const loading = apps === null && !error;
  return <div className="min-w-0">
    <PageHeader title="Connectors" sub="Let your bots use the apps you already use. Connect once per workspace." action={workspaces && workspaces.length > 0 ? workspaces.length > 3 ? <div className="min-w-0 max-w-full"><label className="sr-only" htmlFor="connector-workspace">Workspace</label><select id="connector-workspace" className="field h-10 w-auto max-w-full truncate" value={workspace?.id ?? ""} onChange={(e) => pick(e.target.value)}>{workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div> : <Toggle label="Workspace" className="max-w-full" value={workspace?.id ?? ""} options={workspaces.map((w) => ({ value: w.id, label: <span className="block max-w-[120px] truncate max-sm:max-w-[60px]" title={w.name}>{w.name}</span> }))} onChange={pick} /> : undefined} />
    {workspace && (cloudForWorkspace(clouds, workspace.id) || workspace.kind === "vps") && <p className="-mt-4 mb-6 break-words text-13 text-ink-3">Connections on {workspace.name} stay on that machine. Your other workspaces keep their own.</p>}
    {!workspace && workspaces !== null && <p className="mb-6 text-13 text-ink-3">Add a workspace to start connecting apps. <ButtonLink to="/workspaces#add" size="sm">Add a workspace</ButtonLink></p>}
    <div className="relative mb-8">
      <label className="sr-only" htmlFor="app-search">Search apps</label>
      <Search size={18} strokeWidth={1.5} className="pointer-events-none absolute left-3.5 top-[13px] text-ink-3" aria-hidden />
      <input id="app-search" type="search" className="field !pl-11" placeholder={apps ? `Search ${apps.length.toLocaleString("en-US")} apps` : "Search apps"} value={query} onChange={(e) => { setQuery(e.target.value); setLimit(24); }} />
    </div>
    {error ? <div className="mb-6 flex flex-wrap items-center gap-3"><p role="alert" className="text-13 text-bad">{error}</p><Button size="sm" onClick={() => location.reload()}>Retry</Button></div> : <>
      <section className="enter mb-8 min-w-0">
        <SectionTitle>Connected on <span className="break-all">{workspace?.name ?? "your workspace"}</span></SectionTitle>
        <Card className="!py-2">
          {loading || connections === null && !cloudError ? <Skeleton className="my-4 h-16" /> : connections === null ? <div className="flex flex-wrap items-center gap-3 py-4"><p role="alert" className="text-13 text-bad">{cloudError ?? "Could not load workspace connections."}</p><Button size="sm" onClick={() => location.reload()}>Retry</Button></div> : linked.length ? <ul className="divide-y divide-line">{linked.map((app) => <li key={app.id} className="flex flex-wrap items-center gap-3 py-4"><AppLogo app={app} size={36} /><div className="min-w-0 flex-1"><div className="truncate text-14 font-medium text-ink">{app.label}</div><p className="truncate text-13 text-ink-3">{app.description}</p></div><div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:pl-[48px]"><Badge tone="good"><Check size={13} strokeWidth={1.5} aria-hidden />Connected</Badge><ButtonLink size="sm" to={APP_LINK} external>Manage</ButtonLink></div></li>)}</ul> : <p className="break-words py-4 text-13 text-ink-3">{workspace ? `Nothing connected on ${workspace.name} yet. Pick an app below.` : "Pick a workspace to see its connections."}</p>}
        </Card>
      </section>
      <div role="tablist" aria-label="App category" className="scroll-x mb-5 flex max-w-full gap-2">
        {[{ id: "popular" as const, name: "Popular" }, ...(apps ? presentCategories(apps).map((cat) => ({ id: cat, name: CATEGORY_NAMES[cat] })) : [])].map((cat) => <button key={cat.id} type="button" role="tab" aria-selected={category === cat.id} onClick={() => { setCategory(cat.id); setLimit(24); }} className={cx("press-soft h-8 shrink-0 rounded-full px-3 text-13", category === cat.id ? "bg-card-2 text-ink" : "hover-outline border border-line-2 text-ink-3")}>{cat.name}</button>)}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy={loading}>
        {loading ? Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-[194px] !rounded-card" />) : results.slice(0, limit).map((app, i) => <article key={app.id} className="enter flex min-w-0 flex-col rounded-card bg-card p-4" style={{ ["--i" as string]: i % 3 }}><div className="flex min-w-0 items-center gap-3"><AppLogo app={app} size={40} /><h2 className="truncate text-14 font-medium text-ink">{app.label}</h2></div><p className="mb-5 mt-3 line-clamp-2 text-13 text-ink-3">{app.description}</p><div className="mt-auto flex min-h-8 items-center">{connectedIn(app, connected) ? <span className="inline-flex items-center gap-1.5 text-13 text-good"><Check size={15} strokeWidth={1.5} aria-hidden />Connected</span> : <Button size="sm" disabled={!workspace || connections === null} onClick={() => connect(app)}>Connect</Button>}</div></article>)}
      </div>
      {!loading && !results.length && <p className="py-8 text-13 text-ink-3">{query.trim() ? `No apps match “${query.trim()}”. Try another name.` : "No apps in this category yet."}</p>}
      {results.length > limit && <div className="mt-6 flex justify-center"><Button onClick={() => setLimit((value) => value + 24)}>Show more</Button></div>}
    </>}
  </div>;
}
