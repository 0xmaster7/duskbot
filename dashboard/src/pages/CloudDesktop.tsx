import { useEffect, useState } from "react";
import { AppWindow, Check } from "lucide-react";
import { useCloud } from "../data/cloud";
import type { CloudDesktop, DesktopTier, PlanCatalog, SlackWake } from "../data/contracts";
import { botsLine, desktopMonthly, desktopOf, dollars, specLine } from "../data/pricing";
import { useSession } from "../data/session";
import { api, ApiError } from "../lib/api";
import { longDate } from "../lib/format";
import { SETUP_LABELS } from "../data/live";
import { SETUP_STEPS } from "../data/wire";
import { Link } from "../lib/router";
import { appLink, openApp } from "../lib/app-link";
import { Choice, Modal, Switch } from "../ui/controls";
import { Button, Card, cx, KV, PageHeader, SectionTitle, Skeleton } from "../ui/kit";
import { Mascot } from "../ui/Mascot";
import { useWorkspaceDetail } from "../data/detail";
import { CloudPitch, CloudStatus, PowerButton, Provisioning, regionName, tierName } from "./cloud-bits";
import { MachineView } from "./Machine";
import { money, useChangeCharge } from "./plan-sheet";
import { useNow } from "../lib/now";

/** no cloud desktop yet: the one pitch, then the sizes it comes in */
function Empty() {
  const { catalog } = useCloud();
  return (
    <div className="flex flex-col gap-4">
      <CloudPitch title="Keep your bots on 24/7" body="A cloud desktop of your own runs your bots all day and all night, even while your Mac sleeps." link={{ to: "/workspaces#add", label: "Use my own server instead" }} />
      <Card className="enter" style={{ ["--i" as string]: 1 }} aria-labelledby="sizes-title">
        <SectionTitle id="sizes-title" action={<Link to="/billing" className="hover-link inline-flex h-8 items-center text-13 text-ink-3">Plans & billing</Link>}>Sizes</SectionTitle>
        {catalog ? (
          <ul className="divide-y divide-line">
            {catalog.desktops.map((d) => (
              <li key={d.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 md:grid-cols-[160px_minmax(0,1fr)_200px_auto]">
                <span className="text-14 font-medium text-ink">{d.name}</span>
                <span className="num truncate text-13 text-ink-3 max-md:hidden">{specLine(d)}</span>
                <span className="truncate text-13 text-ink-3 max-md:hidden">{botsLine(d.botComputers)}{d.priority ? ", priority wake" : ""}</span>
                <span className="num text-end text-14 text-ink">{d.sizable ? "from " : ""}{dollars(desktopMonthly(d, null, catalog.custom))}<span className="text-ink-3">/mo</span></span>
              </li>
            ))}
          </ul>
        ) : <Skeleton className="h-32" />}
        {catalog && <p className="mt-4 text-13 text-ink-3">Regions: {catalog.regions.map((r) => r.city).join(", ")}. Every size has its own sandbox, network and disk.</p>}
      </Card>
    </div>
  );
}

const STEPS: string[] = SETUP_STEPS.map((step) => SETUP_LABELS[step]);

function SettingUp({ cloud }: { cloud: CloudDesktop }) {
  const at = Math.max(0, STEPS.indexOf(cloud.progress?.step ?? ""));
  return (
    <Card className="!p-8 max-sm:!p-5" aria-labelledby="setup-title">
      <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_200px] md:items-center">
        <div className="min-w-0">
          <h2 id="setup-title" className="text-20 font-semibold tracking-[-0.015em] text-ink">Setting up {cloud.name}</h2>
          <p className="mt-1 text-14 text-ink-3">About a minute. Your bots move in by themselves.</p>
          <div className="mt-6"><Provisioning cloud={cloud} /></div>
          <ol className="mt-6 flex flex-col gap-2.5">
            {STEPS.map((s, i) => (
              <li key={s} className={cx("flex items-center gap-3 text-14", i < at ? "text-ink-3" : i === at ? "text-ink" : "text-ink-4")}>
                <span className="grid size-4 shrink-0 place-items-center" aria-hidden>
                  {i < at ? <Check size={14} strokeWidth={2} /> : <span className={cx("live-dot !size-1.5", i === at ? "text-ink" : "text-ink-4")} data-live={i === at} />}
                </span>
                {s}<span className="sr-only">{i < at ? ", done" : i === at ? ", in progress" : ""}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex items-end justify-center gap-1 max-md:hidden" aria-hidden>
          <Mascot color="orange" size={36} />
          <span className="mb-3 inline-flex"><Mascot color="blue" size={48} /></span>
          <Mascot color="green" size={36} />
        </div>
      </div>
    </Card>
  );
}

/** the size it is, what that includes, and the next size up */
function Size({ cloud, catalog }: { cloud: CloudDesktop; catalog: PlanCatalog }) {
  const { billing } = useCloud();
  const { toast } = useSession();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<DesktopTier["id"]>(cloud.tier);
  const target = billing?.subscription ? { ...billing.subscription.selection, desktop: to, size: null } : null;
  const { charge, apply } = useChangeCharge(target);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sub = billing?.subscription;
  const current = desktopOf(catalog, cloud.tier);
  const next = catalog.desktops[catalog.desktops.findIndex((d) => d.id === cloud.tier) + 1] ?? null;
  const go = async () => {
    if (!sub) return;
    setBusy(true); setError(null);
    try { if (await apply({ ...sub.selection, desktop: to, size: null })) { toast(`Resizing ${cloud.name}. It restarts once, in under a minute.`); setOpen(false); } }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const includes = [
    specLine(cloud),
    botsLine(cloud.botComputers.limit),
    cloud.placement === "shared" ? "Its own sandbox on a shared host" : "A whole machine of its own",
    current?.priority ? "On 24/7, priority wake" : "On 24/7",
  ];
  return (
    <Card aria-labelledby="size-title" className="flex flex-col">
      <SectionTitle id="size-title" action={<Button size="sm" onClick={() => { setTo(cloud.tier); setOpen(true); }} disabled={!sub}>Resize</Button>}>Size</SectionTitle>
      <p className="flex items-baseline gap-2"><span className="text-24 font-semibold tracking-[-0.02em] text-ink">{current?.name ?? tierName(catalog, cloud)}</span>{current && <span className="num text-14 text-ink-3">{dollars(desktopMonthly(current, null, catalog.custom))}/mo</span>}</p>
      <ul className="mt-4 flex flex-col gap-2">
        {includes.map((line) => <li key={line} className="flex gap-2.5 text-14 text-ink-2"><Check size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-4" aria-hidden />{line}</li>)}
      </ul>
      {next && (
        <div className="mt-auto pt-6">
          <div className="rounded-[12px] border border-line px-4 py-3.5">
            <p className="text-13 leading-[1.5] text-ink-3"><span className="text-ink-2">Need more room?</span> {next.name} gives you {botsLine(next.botComputers).toLowerCase()}{next.priority && !current?.priority ? " and priority wake" : ""}.</p>
            <button type="button" onClick={() => { setTo(next.id); setOpen(true); }} disabled={!sub} className="hover-link mt-2 inline-flex h-8 items-center text-13 font-medium text-ink-2 disabled:opacity-45">Upgrade to {next.name}</button>
          </div>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={`Resize ${cloud.name}`} wide footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => void go()} disabled={busy || to === cloud.tier}>{busy ? "Resizing" : charge !== null ? `Pay ${money(charge)} and resize` : "Resize"}</Button></>}>
        <p>It restarts once, usually in under a minute. Bots, files and logins come along. A bigger size charges the difference now; you see the amount before you confirm.</p>
        <fieldset className="mt-4 min-w-0">
          <legend className="sr-only">Size</legend>
          <div className="flex flex-col gap-1">
            {catalog.desktops.map((d) => (
              <Choice key={d.id} name="resize" value={d.id} checked={to === d.id} onChange={() => setTo(d.id)} title={<>{d.name}{d.id === cloud.tier && <span className="ms-2 text-13 text-ink-3">Current</span>}</>} detail={`${specLine(d)} · ${botsLine(d.botComputers)}`} aside={<>{dollars(desktopMonthly(d, null, catalog.custom))}<span className="text-ink-3">/mo</span></>} />
            ))}
          </div>
        </fieldset>
        {charge !== null && <p role="status" className="num mt-3 text-13 text-ink-2">You pay {money(charge)} now, then the new size's price from {longDate(billing?.subscription?.currentPeriodEnd ?? 0)}.</p>}
        {error && <p role="alert" className="mt-3 text-13 text-bad">{error}</p>}
      </Modal>
    </Card>
  );
}

function SlackWakeSetting({ cloud }: { cloud: CloudDesktop }) {
  const { toast } = useSession();
  const [wake, setWake] = useState<SlackWake | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (busy) return;
    const ctl = new AbortController();
    let unavailable = false;
    let loading = false;
    const load = async () => {
      if (unavailable || loading || document.visibilityState !== "visible") return;
      loading = true;
      try {
        const answer = await api.slackWake(cloud.id, ctl.signal);
        if (!ctl.signal.aborted) { setWake(answer); unavailable = !answer.available; }
      } catch (e) {
        if (!ctl.signal.aborted && e instanceof ApiError && e.status === 404) { setWake(null); unavailable = true; }
      } finally { loading = false; }
    };
    void load();
    const timer = setInterval(() => void load(), 15_000);
    document.addEventListener("visibilitychange", load);
    return () => { ctl.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [cloud.id, cloud.status, busy]);
  const change = async (enabled: boolean) => {
    setBusy(true);
    try { setWake(await api.setSlackWake(cloud.id, enabled)); }
    catch (e) {
      if (e instanceof ApiError && e.status === 404) setWake(null);
      else toast((e as Error).message, "bad");
    } finally { setBusy(false); }
  };
  if (!wake?.available) return null;
  const waiting = (wake.state === "holding" || wake.state === "waking") && wake.buffered > 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3">
      <dt className="text-14 text-ink-3">Wake for Slack</dt>
      <dd><Switch label="Wake for Slack" checked={wake.enabled} disabled={busy} onChange={(enabled) => void change(enabled)} /></dd>
      <dd className="col-span-2 text-13 text-ink-3" aria-live="polite">{waiting ? `${wake.buffered} Slack ${wake.buffered === 1 ? "message" : "messages"} waiting, waking ${cloud.name}` : "While it sleeps we keep its Slack connection, seal each message to this desktop and wake it. Only the desktop can read them."}</dd>
    </div>
  );
}

function Live({ cloud }: { cloud: CloudDesktop }) {
  const { catalog, billing } = useCloud();
  const { pick, workspace } = useSession();
  const now = useNow();
  const detail = useWorkspaceDetail(cloud.workspaceId);
  useEffect(() => { if (cloud.workspaceId && workspace?.id !== cloud.workspaceId) pick(cloud.workspaceId); }, [cloud.workspaceId, workspace?.id, pick]);
  const asleep = cloud.status === "sleeping" || cloud.status === "stopped";
  const sub = billing?.subscription;
  return (
    <div className="flex flex-col gap-4">
      {cloud.status === "error" && (
        <Card className="!py-4" aria-live="polite">
          <p className="text-14 text-bad">{cloud.error ?? "It stopped answering."}</p>
          <p className="mt-1 text-13 text-ink-3">Waking it usually fixes this. If it does not, write to us and we look at it right away.</p>
        </Card>
      )}
      {asleep && (
        <Card className="flex flex-wrap items-center gap-5">
          <Mascot color="silver" size={40} state="sleeping" />
          <div className="min-w-0 flex-1">
            <h2 className="text-15 font-medium text-ink">{cloud.name} is asleep</h2>
            <p className="mt-0.5 text-14 text-ink-3">Your bots and their routines wait until you wake it. Nothing on it is lost.</p>
          </div>
          <PowerButton cloud={cloud} size="md" />
        </Card>
      )}
      {detail ? <MachineView detail={detail} now={now} limit={cloud.botComputers.limit} region={regionName(catalog, cloud.region)} /> : cloud.status === "running" ? <Skeleton className="h-[170px] !rounded-card" /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Card aria-labelledby="about-title">
          <SectionTitle id="about-title">About</SectionTitle>
          <dl className="divide-y divide-line">
            <KV k="Runs on" v={cloud.placement === "shared" ? "Shared, own sandbox" : "Its own machine"} />
            <KV k="Bot computers" v={`${detail?.report?.computers?.computers.length ?? cloud.botComputers.used} of ${cloud.botComputers.limit === null ? "unlimited" : cloud.botComputers.limit}`} />
            {(cloud.status === "running" || cloud.status === "sleeping") && <SlackWakeSetting key={cloud.id} cloud={cloud} />}
            <KV k="Created" v={longDate(cloud.createdAt)} />
            {sub && <KV k={sub.cancelAt ? "Ends" : "Renews"} v={longDate(sub.cancelAt ?? sub.currentPeriodEnd)} />}
          </dl>
          <p className="mt-4 text-13 text-ink-3">To remove it, cancel it in <Link to="/billing" className="hover-link underline decoration-line-2 underline-offset-4">Plans & billing</Link>.</p>
        </Card>
        {catalog ? <Size cloud={cloud} catalog={catalog} /> : <Skeleton className="h-[220px] !rounded-card" />}
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
        <Empty />
      </div>
    );
  }
  const running = cloud.status === "running";
  return (
    <div>
      <PageHeader
        title={cloud.name}
        sub={<span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"><CloudStatus cloud={cloud} /><span className="text-13 text-ink-4">{tierName(catalog, cloud)} · {regionName(catalog, cloud.region)}</span></span>}
        action={cloud.status === "provisioning" ? undefined : <div className="flex gap-2"><PowerButton cloud={cloud} size="md" /><Button variant={running ? "primary" : "outline"} onClick={() => openApp(appLink.cloud)}><AppWindow size={16} strokeWidth={1.5} aria-hidden />Open in the app</Button></div>}
      />
      {cloud.status === "provisioning" ? <SettingUp cloud={cloud} /> : <Live cloud={cloud} />}
    </div>
  );
}
