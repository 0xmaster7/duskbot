import { useEffect, useState } from "react";
import { AppWindow, Check } from "lucide-react";
import { useCloud } from "../data/cloud";
import type { CloudDesktop, DesktopTier, PlanCatalog } from "../data/contracts";
import { botsLine, desktopMonthly, dollars, specLine } from "../data/pricing";
import { useSession } from "../data/session";
import { longDate } from "../lib/format";
import { Link } from "../lib/router";
import { APP_LINK } from "../lib/usage";
import { Choice, Modal } from "../ui/controls";
import { Button, ButtonLink, cx, KV, PageHeader, Skeleton } from "../ui/kit";
import { SectionHead } from "../ui/table";
import { Mascot } from "../ui/Mascot";
import { useWorkspaceDetail } from "../data/detail";
import { CloudStatus, PowerButton, Provisioning, regionName, tierName } from "./cloud-bits";
import { MachineView } from "./Machine";

/** no cloud desktop yet: say so, point at the plans, and offer the free path */
function Empty() {
  return (
    <div className="enter border-y border-line py-14 text-center">
      <div className="flex justify-center" aria-hidden><Mascot color="silver" size={40} state="sleeping" /></div>
      <h2 className="mt-4 text-16 font-semibold tracking-[-0.01em] text-ink">No cloud desktop yet</h2>
      <p className="mx-auto mt-1 max-w-[44ch] text-14 text-ink-3">It keeps your bots on 24/7, even while your Mac sleeps.</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        <ButtonLink to="/billing" variant="primary">See plans</ButtonLink>
        <Link to="/workspaces#add" className="hover-link inline-flex h-9 items-center text-14 text-ink-3 max-sm:h-11">Use my own server instead</Link>
      </div>
    </div>
  );
}

const STEPS = ["Reserving your machine", "Installing OpenMausBot", "Linking it to your account", "Waking your bots"];

function SettingUp({ cloud }: { cloud: CloudDesktop }) {
  const at = Math.max(0, STEPS.indexOf(cloud.progress?.step ?? ""));
  return (
    <section className="max-w-[520px]" aria-labelledby="setup-title">
      <h2 id="setup-title" className="text-16 font-semibold tracking-[-0.01em] text-ink">Setting up {cloud.name}</h2>
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
    </section>
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
  const go = async () => {
    if (!sub) return;
    setBusy(true); setError(null);
    try { await changePlan({ ...sub.selection, desktop: to, size: null }); toast(`Resizing ${cloud.name}. It restarts once, in under a minute.`); setOpen(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" onClick={() => { setTo(cloud.tier); setOpen(true); }} disabled={!sub} className="hover-link text-14 text-ink-3 disabled:opacity-45">Resize</button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Resize ${cloud.name}`} wide footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => void go()} disabled={busy || to === cloud.tier}>{busy ? "Resizing" : "Resize"}</Button></>}>
        <p>It restarts once, usually in under a minute. Bots, files and logins come along. The new price starts today, prorated.</p>
        <fieldset className="mt-4 min-w-0">
          <legend className="sr-only">Size</legend>
          <div className="flex flex-col gap-1">
            {catalog.desktops.map((d) => (
              <Choice key={d.id} name="resize" value={d.id} checked={to === d.id} onChange={() => setTo(d.id)} title={<>{d.name}{d.id === cloud.tier && <span className="ms-2 text-13 text-ink-3">Current</span>}</>} detail={`${specLine(d)} · ${botsLine(d.botComputers)}`} aside={<>{dollars(desktopMonthly(d, null, catalog.custom))}<span className="text-ink-3">/mo</span></>} />
            ))}
          </div>
        </fieldset>
        {error && <p role="alert" className="mt-3 text-13 text-bad">{error}</p>}
      </Modal>
    </>
  );
}

function Details({ cloud, version }: { cloud: CloudDesktop; version: string | null }) {
  const { catalog } = useCloud();
  return (
    <section aria-labelledby="details-title">
      <SectionHead id="details-title">Details</SectionHead>
      <dl className="divide-y divide-line border-y border-line">
        <div className="flex items-baseline justify-between gap-4 py-3 text-14">
          <dt className="text-ink-3">Size</dt>
          <dd className="flex min-w-0 items-baseline gap-4"><span className="num truncate text-ink">{tierName(catalog, cloud)} · {specLine(cloud)}</span>{catalog && <Resize cloud={cloud} catalog={catalog} />}</dd>
        </div>
        {version && <KV className="!py-3" k="Version" v={version} />}
        <KV className="!py-3" k="Runs on" v={cloud.placement === "shared" ? "Shared, in its own sandbox" : "Its own machine"} />
        <KV className="!py-3" k="Created" v={longDate(cloud.createdAt)} />
      </dl>
      <p className="mt-3 text-13 text-ink-3">To remove it, cancel your plan in <Link to="/billing" className="hover-link underline decoration-line-2 underline-offset-4">Plans & billing</Link>.</p>
    </section>
  );
}

function Live({ cloud }: { cloud: CloudDesktop }) {
  const { now, pick, workspace } = useSession();
  const detail = useWorkspaceDetail(cloud.workspaceId);
  useEffect(() => { if (cloud.workspaceId && workspace?.id !== cloud.workspaceId) pick(cloud.workspaceId); }, [cloud.workspaceId, workspace?.id, pick]);
  const asleep = cloud.status === "sleeping" || cloud.status === "stopped";
  return (
    <div className="flex flex-col gap-12">
      {cloud.status === "error" && <p role="alert" className="-mt-4 text-14 text-bad">{cloud.error ?? "It stopped answering."} <span className="text-ink-3">Waking it usually fixes this. If not, write to us.</span></p>}
      {asleep && <p className="-mt-4 text-14 text-ink-3">Your bots and their routines wait until you wake it. Nothing on it is lost.</p>}
      {detail ? <MachineView detail={detail} now={now} limit={cloud.botComputers.limit} server={false} /> : cloud.status === "running" ? <Skeleton className="h-[170px] !rounded-card" /> : null}
      <Details cloud={cloud} version={detail?.report?.machine?.app.version ?? null} />
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
        <PageHeader title="Cloud desktop" />
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
        action={cloud.status === "provisioning" ? undefined : <div className="flex gap-2"><PowerButton cloud={cloud} size="md" /><ButtonLink to={APP_LINK} external variant={running ? "primary" : "outline"}><AppWindow size={16} strokeWidth={1.5} aria-hidden />Open in the app</ButtonLink></div>}
      />
      {cloud.status === "provisioning" ? <SettingUp cloud={cloud} /> : <Live cloud={cloud} />}
    </div>
  );
}
