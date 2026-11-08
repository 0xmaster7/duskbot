import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Copy, Laptop, Smartphone } from "lucide-react";
import type { WorkspaceDetail, WorkspaceSummary } from "../../../shared/dashboard-protocol";
import { cloudForWorkspace, useCloud } from "../data/cloud";
import type { CloudDesktop } from "../data/contracts";
import { useWorkspaceDetail } from "../data/detail";
import { useSession } from "../data/session";
import { api } from "../lib/api";
import { ago, longDate } from "../lib/format";
import { Link } from "../lib/router";
import { DOWNLOAD_URL } from "../lib/usage";
import { Field, Modal } from "../ui/controls";
import { Badge, Button, ButtonLink, Card, FreshnessTag, PageHeader, SectionTitle, Skeleton } from "../ui/kit";
import { KIND_LABEL } from "../ui/Shell";
import { SkyEmpty } from "../ui/Sky";
import { CloudStatus, regionName, tierName, workspaceIcon } from "./cloud-bits";
import { CommandButton } from "./common";
import { MachineView } from "./Machine";

const INSTALL = "curl -fsSL https://openmausbot.com/install.sh | sh";
const ICON = { size: 18, strokeWidth: 1.5 } as const;

function WorkspaceRow({ w, cloud }: { w: WorkspaceSummary; cloud: CloudDesktop | null }) {
  const { now, refresh, toast } = useSession();
  const { clouds } = useCloud();
  const [name, setName] = useState(w.name);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const next = name.trim();
    if (!next) { setError("Enter a workspace name."); return; }
    if (next === w.name) { setEditing(false); return; }
    setBusy(true); setError(null);
    try { await api.rename(w.id, next); toast(`Renamed to ${next}`); setEditing(false); refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError(null);
    try { await api.forget(w.id); toast(`Removed ${w.name}`); setRemoving(false); refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <li className="hover-row rounded-[12px] px-3 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-card-2 text-ink-2">{workspaceIcon(w, cloud)}</span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form className="step-in" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <Field label="Workspace name" htmlFor={`workspace-name-${w.id}`} error={error}>
                <input id={`workspace-name-${w.id}`} className="field" value={name} maxLength={60} autoFocus disabled={busy} aria-invalid={Boolean(error)} onChange={(e) => setName(e.target.value)} />
              </Field>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" type="submit" disabled={busy}>{busy ? "Saving" : "Save"}</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setName(w.name); setError(null); }}>Cancel</Button>
              </div>
            </form>
          ) : <>
            <div className="truncate text-14 font-medium text-ink">{w.name}</div>
            <p className="mt-0.5 text-13 text-ink-3">{KIND_LABEL(w.kind, cloud)} · {w.version} · connected {longDate(w.connectedAt)}</p>
            <FreshnessTag freshness={w.freshness} at={w.lastReportAt} now={now} className="mt-1 sm:hidden" />
          </>}
        </div>
        {!editing && <>
          <FreshnessTag freshness={w.freshness} at={w.lastReportAt} now={now} className="max-sm:hidden" />
          <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:pl-[52px]">
            <ButtonLink size="sm" to={`/workspaces/${encodeURIComponent(w.id)}`}>Open</ButtonLink>
            <Button size="sm" variant="ghost" onClick={() => { setName(w.name); setError(null); setEditing(true); }}>Rename</Button>
            {cloud ? <><Badge>Cloud desktop</Badge><ButtonLink size="sm" to="/cloud">Manage</ButtonLink></> : <Button size="sm" variant="ghost" disabled={clouds === null} onClick={() => { setError(null); setRemoving(true); }}>Remove</Button>}
          </div>
        </>}
      </div>
      <Modal open={removing} onClose={() => { if (!busy) setRemoving(false); }} title={`Remove ${w.name}?`} footer={<><Button disabled={busy} onClick={() => setRemoving(false)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => void remove()}>{busy ? "Removing" : "Remove workspace"}</Button></>}>
        <p>It stops reporting until you connect it again from the app. Your bots and files stay on the machine.</p>
        {error && <p role="alert" className="mt-3 text-13 text-bad">{error}</p>}
      </Modal>
    </li>
  );
}

function Step({ n, title, children }: { n: number; title: ReactNode; children?: ReactNode }) {
  return <li className="flex min-w-0 gap-3"><span className="num grid size-8 shrink-0 place-items-center rounded-full border border-line-2 text-13 text-ink-2" aria-hidden>{n}</span><div className="min-w-0 flex-1 pt-1"><div className="text-14 font-medium text-ink">{title}</div>{children && <div className="mt-1 text-13 leading-[1.55] text-ink-3">{children}</div>}</div></li>;
}

export function WorkspacesPage() {
  const { workspaces, toast } = useSession();
  const { clouds } = useCloud();
  const groups = [
    { title: "Cloud desktops", rows: workspaces?.filter((w) => cloudForWorkspace(clouds, w.id)) ?? [] },
    { title: "Your computers", rows: workspaces?.filter((w) => !cloudForWorkspace(clouds, w.id) && w.kind !== "vps") ?? [] },
    { title: "Your servers", rows: workspaces?.filter((w) => !cloudForWorkspace(clouds, w.id) && w.kind === "vps") ?? [] },
  ];
  const copy = async () => {
    try { await navigator.clipboard.writeText(INSTALL); toast("Copied"); }
    catch { toast("Could not copy the install command. Select it and copy it manually.", "bad"); }
  };
  return (
    <div className="min-w-0">
      <PageHeader title="Workspaces" sub="Every place your bots run: your Mac, your own server and your cloud desktops." />
      <div className="flex flex-col gap-4">
        <Card className="enter !p-3">
          {workspaces === null ? <Skeleton className="h-28" /> : workspaces.length ? groups.filter((g) => g.rows.length).map((g) => <div key={g.title}><h2 className="px-3 pb-1 pt-3 text-13 text-ink-3">{g.title}</h2><ul className="divide-y divide-line">{g.rows.map((w) => <WorkspaceRow key={w.id} w={w} cloud={cloudForWorkspace(clouds, w.id)} />)}</ul></div>) : <p className="p-3 text-14 text-ink-3">No workspaces yet. Add your Mac or server below.</p>}
        </Card>
        {clouds?.length === 0 && <div className="enter flex flex-wrap items-center justify-between gap-4 rounded-card border border-line px-6 py-4" style={{ ["--i" as string]: 1 }}><p className="min-w-0 max-w-[64ch] text-13 leading-[1.55] text-ink-3">Self-hosted works, until the machine sleeps or reboots. A cloud desktop stays on 24/7 and we keep it updated.</p><ButtonLink size="sm" to="/cloud">See cloud desktops</ButtonLink></div>}
        <section id="add" className="enter scroll-mt-20" style={{ ["--i" as string]: 2 }}>
          <Card>
            <SectionTitle>Add a workspace</SectionTitle>
            <div className="grid min-w-0 gap-6 md:grid-cols-2 md:gap-0">
              <div className="min-w-0 md:pr-6">
                <h3 className="mb-5 text-14 font-medium text-ink">Your Mac</h3>
                <ol className="flex flex-col gap-5">
                  <Step n={1} title={<a className="hover-link underline decoration-line-2 underline-offset-4" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">Download OpenMausBot for Mac</a>} />
                  <Step n={2} title="Sign in with this account">It shows up here by itself a few seconds later.</Step>
                  <Step n={3} title="Keep it awake">Your bots run while the Mac is on. For 24/7, add a cloud desktop.</Step>
                </ol>
              </div>
              <div className="min-w-0 border-line max-md:border-t max-md:pt-6 md:border-l md:pl-6">
                <h3 className="mb-5 text-14 font-medium text-ink">Your own server</h3>
                <ol className="flex flex-col gap-5">
                  <Step n={1} title="Install on your VPS"><div className="mt-2 flex min-w-0 items-center gap-1 rounded-[10px] bg-bg px-3 py-2"><code className="min-w-0 flex-1 break-all font-mono text-13 text-ink-2">{INSTALL}</code><button type="button" aria-label="Copy install command" className="press hover-ghost grid size-11 shrink-0 place-items-center rounded-full text-ink-3" onClick={() => void copy()}><Copy size={16} strokeWidth={1.5} aria-hidden /></button></div></Step>
                  <Step n={2} title="Sign in when it asks" />
                  <Step n={3} title="It reports here">Machine, bots and bot computers, live.</Step>
                </ol>
              </div>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}

function WorkspaceDevices({ detail, now, ready }: { detail: WorkspaceDetail; now: number; ready: boolean }) {
  const devices = detail.report?.devices;
  return <Card>
    <SectionTitle>Phones and signed-in apps</SectionTitle>
    {!devices ? <p className="text-13 text-ink-3">This workspace has not sent its devices yet.</p> : <>
      <h3 className="text-13 text-ink-3">Phones</h3>
      {devices.phones.length ? <ul className="divide-y divide-line">{devices.phones.map((p) => <li key={p.id} className="flex items-center gap-3 py-3"><Smartphone {...ICON} className="shrink-0 text-ink-3" aria-hidden /><div className="min-w-0 flex-1"><div className="truncate text-14 text-ink">{p.label}</div><p className="truncate text-13 text-ink-3">{[p.platform, p.lastSeenAt ? `seen ${ago(p.lastSeenAt, now)}` : p.pairedAt ? `paired ${ago(p.pairedAt, now)}` : null].filter(Boolean).join(" · ")}</p></div><CommandButton kind="phone.revoke" target={p.id} label="Revoke" doing="Revoking" variant="danger" disabled={!ready} confirm={`Revoke ${p.label}? It will need to pair again.`} /></li>)}</ul> : <p className="mt-2 text-13 text-ink-3">No phones paired. Pair a phone from the account menu in the app.</p>}
      <h3 className="mt-6 text-13 text-ink-3">Signed-in apps and browsers</h3>
      {devices.sessions.length ? <ul className="divide-y divide-line">{devices.sessions.map((s) => <li key={s.id} className="flex items-center gap-3 py-3"><Laptop {...ICON} className="shrink-0 text-ink-3" aria-hidden /><div className="min-w-0 flex-1"><div className="truncate text-14 text-ink">{s.label}</div><p className="truncate text-13 text-ink-3">{[s.scopes.includes("admin") ? "Owner" : "Member", s.lastSeenAt ? `active ${ago(s.lastSeenAt, now)}` : s.createdAt ? `signed in ${ago(s.createdAt, now)}` : null].filter(Boolean).join(" · ")}</p></div><CommandButton kind="session.revoke" target={s.id} label="Sign out" doing="Signing out" variant="danger" disabled={!ready} confirm={`Sign ${s.label} out of this workspace?`} /></li>)}</ul> : <p className="mt-2 text-13 text-ink-3">Only the app on this computer. Nothing else is signed in.</p>}
    </>}
  </Card>;
}

export function WorkspacePage({ id }: { id: string }) {
  const { workspaces, workspace: selected, pick, now, detailError } = useSession();
  const { clouds, catalog } = useCloud();
  const w = workspaces?.find((item) => item.id === id);
  const detail = useWorkspaceDetail(w ? id : null);
  const cloud = cloudForWorkspace(clouds, id);
  useEffect(() => { if (w) pick(id); }, [id, Boolean(w), pick]);
  return <div className="min-w-0">
    <Link to="/workspaces" className="press-soft hover-ghost -ms-2 mb-6 inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-13 text-ink-2"><ArrowLeft size={15} strokeWidth={1.5} aria-hidden /> Workspaces</Link>
    {workspaces === null ? <Skeleton className="h-60 !rounded-card" /> : !w ? <SkyEmpty title="That workspace is not on your account">It may have been removed. Choose a workspace from the list.</SkyEmpty> : <>
      <header className="mb-8 flex items-center gap-4"><span className="grid size-14 shrink-0 place-items-center rounded-[12px] bg-card-2 text-ink-2">{workspaceIcon(w, cloud, 24)}</span><div className="min-w-0 flex-1"><h1 className="truncate text-28 font-medium tracking-[-0.02em] text-ink">{w.name}</h1><div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-13 text-ink-3"><span>{KIND_LABEL(w.kind, cloud)}</span><FreshnessTag freshness={w.freshness} at={w.lastReportAt} now={now} /></div></div></header>
      <div className="flex flex-col gap-4">
        {cloud && <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line px-6 py-4"><div className="min-w-0"><p className="text-14 text-ink">{tierName(catalog, cloud)} · {regionName(catalog, cloud.region)}</p><CloudStatus cloud={cloud} className="mt-1" /></div><ButtonLink to="/cloud" size="sm">Open cloud desktop</ButtonLink></div>}
        {!detail || selected?.id !== id ? selected?.id === id && detailError ? <Card><p role="alert" className="text-13 text-bad">{detailError}</p></Card> : <Skeleton className="h-60 !rounded-card" /> : !detail.report ? <SkyEmpty title="Waiting for its first report">Keep OpenMausBot running there. Its first report usually arrives in a few seconds.</SkyEmpty> : <><MachineView detail={detail} now={now} /><WorkspaceDevices detail={detail} now={now} ready={selected?.id === id} /></>}
      </div>
    </>}
  </div>;
}
