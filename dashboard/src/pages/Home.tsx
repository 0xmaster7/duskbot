import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { WorkspaceDetail } from "../../../shared/dashboard-protocol";
import { cloudForWorkspace, useCloud } from "../data/cloud";
import { useWorkspaceDetail } from "../data/detail";
import type { CloudDesktop } from "../data/contracts";
import { useSession } from "../data/session";
import { plural } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { Heatmap } from "../ui/Heatmap";
import { Button, FreshnessTag, Skeleton } from "../ui/kit";
import { Mascot } from "../ui/Mascot";
import { KIND_LABEL } from "../ui/Shell";
import { SectionHead } from "../ui/table";
import { CloudStatus, PlanDialog, regionName, tierName, workspaceIcon } from "./cloud-bits";

/** no cloud desktop yet: one line, one sentence, one button */
function CloudPitch() {
  const [open, setOpen] = useState(false);
  return (
    <section className="enter flex items-center gap-8 rounded-card bg-card px-8 py-7 max-sm:flex-col-reverse max-sm:items-start max-sm:gap-5 max-sm:p-5" aria-labelledby="pitch-title">
      <div className="min-w-0 flex-1">
        <h2 id="pitch-title" className="text-20 font-semibold tracking-[-0.015em] text-ink">Keep your bots on while your Mac sleeps</h2>
        <p className="mt-1.5 max-w-[52ch] text-14 leading-[1.55] text-ink-3">A cloud desktop runs them all day and all night. Set up in one click.</p>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Button variant="primary" onClick={() => setOpen(true)}>Get a cloud desktop</Button>
          <Link to="/billing" className="hover-link inline-flex h-9 items-center text-14 text-ink-3 max-sm:h-11">See plans</Link>
        </div>
      </div>
      <div className="flex shrink-0 items-end gap-1 pe-2" aria-hidden>
        <Mascot color="orange" size={36} />
        <span className="mb-3 inline-flex"><Mascot color="blue" size={48} /></span>
        <Mascot color="green" size={36} />
      </div>
      <PlanDialog open={open} onClose={() => setOpen(false)} />
    </section>
  );
}

function Num({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0 text-end max-sm:text-start">
      <div className="num text-20 font-semibold tracking-[-0.015em] text-ink">{value}</div>
      <div className="text-13 text-ink-3">{label}</div>
    </div>
  );
}

/** a cloud desktop: its state in one line and two numbers; the whole card opens it */
function CloudCard({ cloud, detail }: { cloud: CloudDesktop; detail: WorkspaceDetail | null }) {
  const { catalog } = useCloud();
  const bots = detail?.report?.bots ?? [];
  const busy = cloud.status === "running" ? bots.filter((b) => b.busy).length : 0;
  const used = detail?.report?.computers?.computers.length ?? cloud.botComputers.used;
  const v = Math.round((cloud.progress?.value ?? 0) * 100);
  return (
    <Link to="/cloud" className="enter hover-tile flex items-center gap-8 rounded-card bg-card px-8 py-6 transition-colors duration-150 max-sm:flex-wrap max-sm:gap-5 max-sm:p-5" aria-label={`${cloud.name}, open cloud desktop`}>
      <div className="min-w-0 flex-1">
        <div className="text-13 text-ink-3">Cloud desktop</div>
        <div className="mt-0.5 truncate text-17 font-semibold tracking-[-0.01em] text-ink">{cloud.name}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <CloudStatus cloud={cloud} />
          <span className="truncate text-13 text-ink-4">{tierName(catalog, cloud)} · {regionName(catalog, cloud.region)}</span>
        </div>
      </div>
      {cloud.status === "provisioning" ? (
        <div className="w-[220px] max-sm:w-full">
          <div className="flex justify-between text-13 text-ink-3"><span className="truncate">{cloud.progress?.step ?? "Getting ready"}</span><span className="num">{v}%</span></div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label="Setting up your cloud desktop">
            <div className="bar-fill h-full w-full rounded-full bg-ink" style={{ transform: `scaleX(${Math.max(0.03, v / 100)})` }} />
          </div>
        </div>
      ) : (
        <div className="flex gap-10 max-sm:gap-8">
          <Num value={`${busy}`} label={`of ${plural(bots.length, "bot")} working`} />
          <Num value={`${used}`} label={cloud.botComputers.limit === null ? "bot computers" : `of ${cloud.botComputers.limit} computers`} />
        </div>
      )}
      <ChevronRight size={16} strokeWidth={1.5} className="shrink-0 text-ink-4 max-sm:hidden" aria-hidden />
    </Link>
  );
}

function Workspaces() {
  const { workspaces, now, pick } = useSession();
  const { clouds } = useCloud();
  return (
    <section className="enter" style={{ ["--i" as string]: 1 }} aria-labelledby="ws-title">
      <SectionHead id="ws-title" action={<Link to="/workspaces" className="hover-link text-13 text-ink-3">Manage</Link>}>Your workspaces</SectionHead>
      {workspaces === null ? (
        <div className="flex flex-col gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      ) : workspaces.length === 0 ? (
        <p className="border-y border-line py-5 text-14 text-ink-3">Nothing connected yet. <Link to="/workspaces#add" className="hover-link text-ink-2 underline decoration-line-2 underline-offset-4">Connect your Mac</Link> to see it here.</p>
      ) : (
        <ul className="border-t border-line">
          {workspaces.map((w) => {
            const cloud = cloudForWorkspace(clouds, w.id);
            return (
              <li key={w.id} className="border-b border-line">
                <button type="button" onClick={() => { pick(w.id); navigate(cloud ? "/cloud" : `/workspaces/${encodeURIComponent(w.id)}`); }} className="hover-row -mx-3 flex h-12 w-[calc(100%+24px)] items-center gap-3 rounded-row px-3 text-start transition-colors duration-150 max-sm:h-14">
                  <span className="shrink-0 text-ink-3">{workspaceIcon(w, cloud, 16)}</span>
                  <span className="min-w-0 flex-1 truncate text-14 text-ink">{w.name}</span>
                  <span className="w-[140px] truncate text-13 text-ink-3 max-sm:hidden">{KIND_LABEL(w.kind, cloud)}</span>
                  <FreshnessTag freshness={w.freshness} at={w.lastReportAt} now={now} className="w-[170px] justify-end max-sm:w-auto" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Activity({ detail, now }: { detail: WorkspaceDetail; now: number }) {
  const days = detail.report?.activity?.days ?? [];
  const turns = detail.report?.activity?.totals.turns ?? 0;
  return (
    <section className="enter" style={{ ["--i" as string]: 2 }} aria-labelledby="activity-title">
      <SectionHead id="activity-title" action={<Link to="/usage" className="hover-link text-13 text-ink-3">Usage</Link>}>Activity</SectionHead>
      <p className="mb-5 text-14 text-ink-3"><span className="num font-medium text-ink">{turns.toLocaleString("en-US")}</span> bot turns on {detail.workspace.name} this year</p>
      <Heatmap days={days} metric="turns" now={now} />
    </section>
  );
}

export function HomePage() {
  const { account, now, detail, workspaces } = useSession();
  const { clouds } = useCloud();
  const name = account?.name || account?.email.split("@")[0] || "";
  const cloud = clouds?.[0] ?? null;
  const cloudDetail = useWorkspaceDetail(cloud?.workspaceId ?? null);
  return (
    <div>
      <h1 className="enter mb-8 text-28 font-semibold tracking-[-0.025em] text-ink max-sm:mb-6 max-sm:text-24">Welcome, {name}.</h1>
      <div className="flex flex-col gap-12">
        {clouds === null ? <Skeleton className="h-[148px] !rounded-card" /> : cloud ? <CloudCard cloud={cloud} detail={cloudDetail} /> : <CloudPitch />}
        <Workspaces />
        {detail?.report?.activity && workspaces?.length ? <Activity detail={detail} now={now} /> : null}
      </div>
    </div>
  );
}
