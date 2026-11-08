import { useEffect, useState } from "react";
import { AppWindow, Check, Clock, Lock, MousePointerClick } from "lucide-react";
import { useCloud } from "../data/cloud";
import type { CloudDesktop, DesktopTier, PlanCatalog } from "../data/contracts";
import { botsLine, desktopMonthly, desktopOf, dollars, specLine } from "../data/pricing";
import { useSession } from "../data/session";
import { longDate } from "../lib/format";
import { Link } from "../lib/router";
import { APP_LINK } from "../lib/usage";
import { Modal } from "../ui/controls";
import { Button, ButtonLink, Card, cx, KV, PageHeader, SectionTitle, Skeleton } from "../ui/kit";
import { Mascot } from "../ui/Mascot";
import { Nightshift } from "../ui/Nightshift";
import { Stars } from "../ui/Sky";
import { useWorkspaceDetail } from "../data/detail";
import { CloudStatus, PowerButton, Provisioning, QuickPick, regionName, tierName } from "./cloud-bits";
import { MachineView } from "./Machine";

const WHY = [
  { icon: Clock, title: "On 24/7", body: "Your bots answer, run routines and use their computers while your Mac sleeps." },
  { icon: MousePointerClick, title: "One click to set up", body: "We install OpenMausBot and link it to your account. Nothing to configure." },
  { icon: Lock, title: "Yours alone", body: "Its own sandbox, network and disk. Your chats and files stay on it." },
];

function Pitch() {
  const { catalog } = useCloud();
  return (
    <div className="flex flex-col gap-4">
      <Card className="enter grid gap-10 overflow-hidden !p-8 max-sm:!p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:items-center" aria-labelledby="pitch-title">
        <div className="min-w-0">
          <h2 id="pitch-title" className="max-w-[16ch] text-44 font-medium tracking-[-0.03em] text-ink max-sm:text-[32px] max-sm:leading-[38px]">A computer that never sleeps, for your bots.</h2>
          <p className="mt-3 max-w-[50ch] text-16 leading-[1.6] text-ink-3">Close the lid, lose Wi-Fi, go on holiday. Your cloud desktop keeps every bot working, all day and all night.</p>
          <ul className="mt-7 flex flex-col gap-4">
            {WHY.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-card-2 text-ink-2"><Icon size={17} strokeWidth={1.5} aria-hidden /></span>
                <span className="min-w-0"><span className="block text-14 font-medium text-ink">{title}</span><span className="block text-13 leading-[1.5] text-ink-3">{body}</span></span>
              </li>
            ))}
          </ul>
          {catalog ? <QuickPick catalog={catalog} className="mt-8" /> : <Skeleton className="mt-8 h-[150px]" />}
        </div>
        <Nightshift className="max-lg:order-first" />
      </Card>
      <div className="enter flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line px-6 py-4 max-sm:px-4" style={{ ["--i" as string]: 1 }}>
        <p className="min-w-0 flex-1 text-14 text-ink-3">Have your own server? Connect it for free. You keep it running and up to date.</p>
        <ButtonLink to="/workspaces#add" size="sm">Connect a VPS</ButtonLink>
      </div>
    </div>
  );
}

const STEPS = ["Reserving your machine", "Installing OpenMausBot", "Linking it to your account", "Waking your bots"];

function SettingUp({ cloud }: { cloud: CloudDesktop }) {
  const at = Math.max(0, STEPS.indexOf(cloud.progress?.step ?? ""));
  return (
    <Card className="relative overflow-hidden !p-8 max-sm:!p-5" aria-labelledby="setup-title">
      <Stars count={30} seed={5} className="[mask-image:linear-gradient(to_bottom,black,transparent_80%)]" />
      <div className="relative grid gap-8 md:grid-cols-[minmax(0,1fr)_220px] md:items-center">
        <div className="min-w-0">
          <h2 id="setup-title" className="text-20 font-medium text-ink">Setting up {cloud.name}</h2>
          <p className="mt-1 text-14 text-ink-3">We will let you know when it is ready. Your bots move in by themselves.</p>
          <div className="mt-6"><Provisioning cloud={cloud} /></div>
          <ol className="mt-6 flex flex-col gap-2.5">
            {STEPS.map((s, i) => (
              <li key={s} className={cx("flex items-center gap-3 text-14", i < at ? "text-ink-2" : i === at ? "text-ink" : "text-ink-4")}>
                <span className={cx("grid size-5 shrink-0 place-items-center rounded-full border", i < at ? "border-ink bg-ink text-bg" : i === at ? "border-ink-3" : "border-line-2")} aria-hidden>
                  {i < at ? <Check size={12} strokeWidth={2.25} /> : i === at ? <span className="live-dot size-1.5 text-ink" data-live /> : null}
                </span>
                {s}<span className="sr-only">{i < at ? ", done" : i === at ? ", in progress" : ""}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex items-end justify-center gap-2 max-md:hidden" aria-hidden>
          <span className="float inline-flex" style={{ ["--d" as string]: "-0.6s" }}><Mascot color="orange" size={44} state="loading" /></span>
          <span className="float mb-4 inline-flex"><Mascot color="blue" size={60} state="spawning" /></span>
          <span className="float inline-flex" style={{ ["--d" as string]: "-1.8s" }}><Mascot color="green" size={44} state="waking" /></span>
        </div>
      </div>
    </Card>
  );
}

function Resize({ cloud, catalog }: { cloud: CloudDesktop; catalog: PlanCatalog }) {
  const { billing, changePlan } = useCloud();
  const { toast } = useSession();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<DesktopTier["id"]>(cloud.tier);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sub = billing?.subscription;
  const current = desktopOf(catalog, cloud.tier);
  const next = catalog.desktops[catalog.desktops.findIndex((d) => d.id === cloud.tier) + 1] ?? null;
  const go = async () => {
    if (!sub) return;
    setBusy(true); setError(null);
    try { await changePlan({ ...sub.selection, desktop: to, size: null }); toast(`Resizing ${cloud.name}. It restarts once, in under a minute.`); setOpen(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card aria-labelledby="size-title" className="flex flex-col">
      <SectionTitle id="size-title" action={<Button size="sm" onClick={() => { setTo(cloud.tier); setOpen(true); }} disabled={!sub}>Resize</Button>}>Size</SectionTitle>
      <p className="flex items-baseline gap-2"><span className="text-28 font-medium tracking-[-0.02em] text-ink">{current?.name ?? tierName(catalog, cloud)}</span><span className="text-14 text-ink-3">{cloud.placement === "shared" ? "shared" : "dedicated"}</span></p>
      <p className="num mt-1 text-13 text-ink-3">{specLine(cloud)} · {botsLine(cloud.botComputers.limit)}</p>
      {next && (
        <div className="mt-auto pt-6">
          <div className="rounded-[12px] border border-line px-4 py-3.5">
            <p className="text-13 leading-[1.5] text-ink-3"><span className="text-ink-2">Need more room?</span> {next.name} gives you {botsLine(next.botComputers).toLowerCase()}{next.priority ? " and priority wake" : ""}.</p>
            <button type="button" onClick={() => { setTo(next.id); setOpen(true); }} disabled={!sub} className="hover-link mt-2 text-13 font-medium text-ink-2 disabled:opacity-45">Upgrade to {next.name}</button>
          </div>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={`Resize ${cloud.name}`} wide footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => void go()} disabled={busy || to === cloud.tier}>{busy ? "Resizing" : "Resize"}</Button></>}>
        <p>It restarts once while it moves, usually in under a minute. Your bots, files and logins come along. The price changes from today, prorated.</p>
        <div role="radiogroup" aria-label="Size" className="mt-4 flex flex-col gap-2">
          {catalog.desktops.map((d) => (
            <button key={d.id} type="button" role="radio" aria-checked={to === d.id} onClick={() => setTo(d.id)} className={cx("pick press-soft flex items-center gap-3 rounded-[12px] border px-4 py-3 text-start", to === d.id ? "border-ink-4 bg-card-2" : "hover-pick border-line-2")}>
              <span className="min-w-0 flex-1">
                <span className="block text-14 font-medium text-ink">{d.name}{d.id === cloud.tier && <span className="ms-2 text-12 font-normal text-ink-3">Current</span>}</span>
                <span className="block text-13 leading-[1.4] text-ink-3">{specLine(d)} · {botsLine(d.botComputers)}</span>
              </span>
              <span className="num shrink-0 text-14 text-ink">{dollars(desktopMonthly(d, null, catalog.custom))}<span className="text-ink-3">/mo</span></span>
            </button>
          ))}
        </div>
        {error && <p role="alert" className="mt-3 text-13 text-bad">{error}</p>}
      </Modal>
    </Card>
  );
}

function Live({ cloud }: { cloud: CloudDesktop }) {
  const { catalog } = useCloud();
  const { now, pick, workspace } = useSession();
  const detail = useWorkspaceDetail(cloud.workspaceId);
  useEffect(() => { if (cloud.workspaceId && workspace?.id !== cloud.workspaceId) pick(cloud.workspaceId); }, [cloud.workspaceId, workspace?.id, pick]);
  return (
    <div className="flex flex-col gap-4">
      {cloud.status === "error" && (
        <Card className="!py-4" aria-live="polite">
          <p className="text-14 text-bad">{cloud.error ?? "It stopped answering."}</p>
          <p className="mt-1 text-13 text-ink-3">Waking it usually fixes this. If it does not, write to us and we look at it right away.</p>
        </Card>
      )}
      {cloud.status === "sleeping" || cloud.status === "stopped" ? (
        <Card className="relative flex flex-wrap items-center gap-5 overflow-hidden">
          <Stars count={14} seed={2} className="opacity-60" />
          <span className="relative"><Mascot color="silver" size={44} state="sleeping" /></span>
          <div className="relative min-w-0 flex-1">
            <h2 className="text-16 font-medium text-ink">{cloud.name} is asleep</h2>
            <p className="mt-0.5 text-14 text-ink-3">Your bots and their routines wait until you wake it. Nothing on it is lost.</p>
          </div>
          <span className="relative"><PowerButton cloud={cloud} size="md" /></span>
        </Card>
      ) : null}
      {detail ? <MachineView detail={detail} now={now} limit={cloud.botComputers.limit} /> : cloud.status === "running" ? <Skeleton className="h-[170px] !rounded-card" /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Card aria-labelledby="about-title">
          <SectionTitle id="about-title">About</SectionTitle>
          <dl className="divide-y divide-line">
            <KV k="Region" v={regionName(catalog, cloud.region)} />
            <KV k="Runs on" v={cloud.placement === "shared" ? "Shared, own sandbox" : "Its own machine"} />
            <KV k="Bot computers" v={`${detail?.report?.computers?.computers.length ?? cloud.botComputers.used} of ${cloud.botComputers.limit === null ? "unlimited" : cloud.botComputers.limit}`} />
            <KV k="Created" v={longDate(cloud.createdAt)} />
          </dl>
          <p className="mt-4 text-13 text-ink-4">To remove it, cancel your plan in <Link to="/billing" className="hover-link underline decoration-line-2 underline-offset-4">Plans & billing</Link>.</p>
        </Card>
        {catalog ? <Resize cloud={cloud} catalog={catalog} /> : <Skeleton className="h-[220px] !rounded-card" />}
      </div>
    </div>
  );
}

export function CloudDesktopPage() {
  const { clouds, catalog } = useCloud();
  const cloud = clouds?.[0] ?? null;
  if (clouds === null) return <div aria-busy="true" aria-label="Loading"><Skeleton className="h-9 w-64" /><Skeleton className="mt-8 h-[420px] !rounded-card" /></div>;
  if (!cloud) {
    return (
      <div>
        <PageHeader title="Cloud desktop" sub="Your own always-on computer in the cloud, made for your bots." />
        <Pitch />
      </div>
    );
  }
  return (
    <div>
      <PageHeader
        title={cloud.name}
        sub={<span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1"><CloudStatus cloud={cloud} /><span className="text-ink-4">{tierName(catalog, cloud)} · {regionName(catalog, cloud.region)}</span></span>}
        action={cloud.status === "provisioning" ? undefined : <div className="flex gap-2"><PowerButton cloud={cloud} size="md" /><ButtonLink to={APP_LINK} external variant="primary"><AppWindow size={16} strokeWidth={1.5} aria-hidden />Open in the app</ButtonLink></div>}
      />
      {cloud.status === "provisioning" ? <SettingUp cloud={cloud} /> : <Live cloud={cloud} />}
    </div>
  );
}
