import { useEffect, useState } from "react";
import { ArrowLeft, Copy, Laptop, Smartphone } from "lucide-react";
import type { WorkspaceDetail, WorkspaceSummary } from "../../../shared/dashboard-protocol";
import { cloudForWorkspace, useCloud } from "../data/cloud";
import type { CloudDesktop } from "../data/contracts";
import { useWorkspaceDetail } from "../data/detail";
import { useSession } from "../data/session";
import { api } from "../lib/api";
import { ago, longDate } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { DOWNLOAD_URL } from "../lib/usage";
import { Field, Modal } from "../ui/controls";
import { Button, ButtonLink, FreshnessTag, PageHeader, SectionTitle, Skeleton } from "../ui/kit";
import { RowMenu, SectionHead, Table, Td, Th, type MenuItem } from "../ui/table";
import { KIND_LABEL } from "../ui/Shell";
import { SkyEmpty } from "../ui/Sky";
import { CloudStatus, regionName, tierName, workspaceIcon } from "./cloud-bits";
import { CommandButton } from "./common";
import { MachineView } from "./Machine";

const INSTALL = "curl -fsSL https://openmausbot.com/install.sh | sh";
const ICON = { size: 16, strokeWidth: 1.5 } as const;

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
  const menu: MenuItem[] = [
    { label: "Rename", onSelect: () => { setName(w.name); setError(null); setEditing(true); } },
    cloud ? { label: "Manage cloud desktop", onSelect: () => navigate("/cloud") } : { label: "Remove", danger: true, disabled: clouds === null, onSelect: () => { setError(null); setRemoving(true); } },
  ];
  const to = `/workspaces/${encodeURIComponent(w.id)}`;
  return (
    <tr className="hover-row relative transition-colors duration-150">
      <Td>
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-ink-3" aria-hidden>{workspaceIcon(w, cloud, 16)}</span>
          <div className="min-w-0">
            <Link to={to} className="block truncate font-medium text-ink after:absolute after:inset-0 after:content-['']">{w.name}</Link>
            <div className="truncate text-13 text-ink-3 md:hidden">{KIND_LABEL(w.kind, cloud)}</div>
          </div>
        </div>
      </Td>
      <Td className="text-ink-2 max-md:hidden">{KIND_LABEL(w.kind, cloud)}</Td>
      <Td><FreshnessTag freshness={w.freshness} at={w.lastReportAt} now={now} className="!text-14" /></Td>
      <Td className="num whitespace-nowrap text-ink-2 max-lg:hidden">{longDate(w.connectedAt)}</Td>
      <Td className="relative z-10 w-0 !pe-1 !ps-0">
        <RowMenu label={`More for ${w.name}`} items={menu} />
        <Modal open={editing} onClose={() => { if (!busy) setEditing(false); }} title={`Rename ${w.name}`} footer={<><Button disabled={busy} onClick={() => setEditing(false)}>Cancel</Button><Button variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving" : "Save"}</Button></>}>
          <form className="mt-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <Field label="Workspace name" htmlFor={`workspace-name-${w.id}`} error={error}>
              <input id={`workspace-name-${w.id}`} className="field" value={name} maxLength={60} disabled={busy} aria-invalid={Boolean(error)} onChange={(e) => setName(e.target.value)} />
            </Field>
          </form>
        </Modal>
        <Modal open={removing} onClose={() => { if (!busy) setRemoving(false); }} title={`Remove ${w.name}?`} footer={<><Button disabled={busy} onClick={() => setRemoving(false)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => void remove()}>{busy ? "Removing" : "Remove workspace"}</Button></>}>
          <p>It stops reporting until you connect it again from the app. Your bots and files stay on the machine.</p>
          {error && <p role="alert" className="mt-3 text-13 text-bad">{error}</p>}
        </Modal>
      </Td>
    </tr>
  );
}

export function WorkspacesPage() {
  const { workspaces, toast } = useSession();
  const { clouds } = useCloud();
  const rank = (w: WorkspaceSummary) => (cloudForWorkspace(clouds, w.id) ? 0 : w.kind === "vps" ? 2 : 1);
  const sorted = [...(workspaces ?? [])].sort((a, b) => rank(a) - rank(b));
  const copy = async () => {
    try { await navigator.clipboard.writeText(INSTALL); toast("Copied"); }
    catch { toast("Could not copy the install command. Select it and copy it manually.", "bad"); }
  };
  return (
    <div className="min-w-0">
      <PageHeader title="Workspaces" sub="Where your bots run." />
      <div className="flex flex-col gap-4">
        <section className="enter min-w-0" aria-label="Your workspaces">
          {workspaces === null ? <div className="flex flex-col gap-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div> : workspaces.length ? (
            <Table label="Workspaces" className="max-sm:[&_table]:table-fixed max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
              <thead><tr><Th>Name</Th><Th className="max-md:hidden">Type</Th><Th className="max-sm:w-[120px]">Status</Th><Th className="max-lg:hidden">Connected</Th><Th className="w-0 max-sm:w-11"><span className="sr-only">More</span></Th></tr></thead>
              <tbody>{sorted.map((w) => <WorkspaceRow key={w.id} w={w} cloud={cloudForWorkspace(clouds, w.id)} />)}</tbody>
            </Table>
          ) : <p className="border-y border-line py-8 text-14 text-ink-3">No workspaces yet. Add your Mac or server below.</p>}
        </section>
        <section id="add" className="mt-10 scroll-mt-20">
          <SectionHead>Add a workspace</SectionHead>
          <div className="grid min-w-0 gap-x-10 md:grid-cols-2">
            <div className="min-w-0 border-t border-line py-5">
              <h3 className="text-14 font-medium text-ink">Your Mac</h3>
              <p className="mt-2 text-14 text-ink-3">Download the app and sign in with this account. It shows up here by itself.</p>
              <ButtonLink to={DOWNLOAD_URL} external variant="outline" className="mt-4">Download for Mac</ButtonLink>
            </div>
            <div className="min-w-0 border-t border-line py-5">
              <h3 className="text-14 font-medium text-ink">Your own server</h3>
              <p className="mt-2 text-14 text-ink-3">Run this on the server, then sign in when it asks.</p>
              <div className="mt-4 flex min-w-0 items-center gap-1 rounded-[10px] bg-card px-3 py-2">
                <code className="min-w-0 flex-1 break-all font-mono text-13 text-ink-2">{INSTALL}</code>
                <button type="button" aria-label="Copy install command" className="press hover-ghost grid size-11 shrink-0 place-items-center rounded-full text-ink-3" onClick={() => void copy()}><Copy size={16} strokeWidth={1.5} aria-hidden /></button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function WorkspaceDevices({ detail, now, ready }: { detail: WorkspaceDetail; now: number; ready: boolean }) {
  const devices = detail.report?.devices;
  return <section className="mt-6">
    <SectionTitle>Phones and signed-in apps</SectionTitle>
    {!devices ? <p className="text-13 text-ink-3">This workspace has not sent its devices yet.</p> : <>
      <h3 className="text-13 text-ink-3">Phones</h3>
      {devices.phones.length ? <ul className="divide-y divide-line">{devices.phones.map((p) => <li key={p.id} className="flex items-center gap-3 py-3"><Smartphone {...ICON} className="shrink-0 text-ink-3" aria-hidden /><div className="min-w-0 flex-1"><div className="truncate text-14 text-ink">{p.label}</div><p className="truncate text-13 text-ink-3">{[p.platform, p.lastSeenAt ? `seen ${ago(p.lastSeenAt, now)}` : p.pairedAt ? `paired ${ago(p.pairedAt, now)}` : null].filter(Boolean).join(" · ")}</p></div><CommandButton kind="phone.revoke" target={p.id} label="Revoke" doing="Revoking" variant="danger" disabled={!ready} confirm={`Revoke ${p.label}? It will need to pair again.`} /></li>)}</ul> : <p className="mt-2 text-13 text-ink-3">No phones paired. Pair a phone from the account menu in the app.</p>}
      <h3 className="mt-6 text-13 text-ink-3">Signed-in apps and browsers</h3>
      {devices.sessions.length ? <ul className="divide-y divide-line">{devices.sessions.map((s) => <li key={s.id} className="flex items-center gap-3 py-3"><Laptop {...ICON} className="shrink-0 text-ink-3" aria-hidden /><div className="min-w-0 flex-1"><div className="truncate text-14 text-ink">{s.label}</div><p className="truncate text-13 text-ink-3">{[s.scopes.includes("admin") ? "Owner" : "Member", s.lastSeenAt ? `active ${ago(s.lastSeenAt, now)}` : s.createdAt ? `signed in ${ago(s.createdAt, now)}` : null].filter(Boolean).join(" · ")}</p></div><CommandButton kind="session.revoke" target={s.id} label="Sign out" doing="Signing out" variant="danger" disabled={!ready} confirm={`Sign ${s.label} out of this workspace?`} /></li>)}</ul> : <p className="mt-2 text-13 text-ink-3">Only the app on this computer. Nothing else is signed in.</p>}
    </>}
  </section>;
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
      <header className="mb-8 flex items-center gap-4"><span className="shrink-0 text-ink-3" aria-hidden>{workspaceIcon(w, cloud, 20)}</span><div className="min-w-0 flex-1"><h1 className="truncate text-24 font-semibold tracking-[-0.02em] text-ink">{w.name}</h1><div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-13 text-ink-3"><span>{KIND_LABEL(w.kind, cloud)}</span><FreshnessTag freshness={w.freshness} at={w.lastReportAt} now={now} /></div></div></header>
      <div className="flex flex-col gap-4">
        {cloud && <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-3"><p className="text-14 text-ink">{tierName(catalog, cloud)} · {regionName(catalog, cloud.region)}</p><CloudStatus cloud={cloud} /><Link to="/cloud" className="hover-link text-14 text-ink-2">Open cloud desktop</Link></div>}
        {!detail || selected?.id !== id ? selected?.id === id && detailError ? <p role="alert" className="text-13 text-bad">{detailError}</p> : <Skeleton className="h-60 !rounded-card" /> : !detail.report ? <SkyEmpty title="Waiting for its first report">Keep OpenMausBot running there. Its first report usually arrives in a few seconds.</SkyEmpty> : <><MachineView detail={detail} now={now} /><WorkspaceDevices detail={detail} now={now} ready={selected?.id === id} /></>}
      </div>
    </>}
  </div>;
}
