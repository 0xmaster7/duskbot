import { useState, type ReactNode } from "react";
import { Cloud, Laptop, Power, Server } from "lucide-react";
import type { WorkspaceSummary } from "../../../shared/dashboard-protocol";
import { useCloud } from "../data/cloud";
import type { CloudDesktop, DesktopId, PlanCatalog, Selection } from "../data/contracts";
import { botsLine, desktopMonthly, desktopOf, dollars, specLine } from "../data/pricing";
import { useSession } from "../data/session";
import { duration } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { Choice, Modal, StatusDot } from "../ui/controls";
import { Button, ButtonLink, cx, Skeleton } from "../ui/kit";
import { Mascot } from "../ui/Mascot";

export const STATUS: Record<CloudDesktop["status"], { label: string; tone: "good" | "warn" | "bad" | "quiet" | "accent" }> = {
  provisioning: { label: "Setting up", tone: "accent" },
  running: { label: "Running", tone: "good" },
  sleeping: { label: "Asleep", tone: "quiet" },
  stopped: { label: "Off", tone: "quiet" },
  error: { label: "Needs attention", tone: "bad" },
};

export function CloudStatus({ cloud, className }: { cloud: CloudDesktop; className?: string }) {
  const s = STATUS[cloud.status];
  const up = cloud.status === "running" && cloud.uptimeSec ? ` · up ${duration(cloud.uptimeSec)}` : "";
  return <StatusDot tone={s.tone} live={cloud.status === "running" || cloud.status === "provisioning"} className={className}>{s.label}{up}</StatusDot>;
}

export function regionName(catalog: PlanCatalog | null, id: string) {
  const r = catalog?.regions.find((x) => x.id === id);
  return r ? `${r.city}, ${r.name}` : id;
}

export function tierName(catalog: PlanCatalog | null, cloud: CloudDesktop) {
  return (catalog && desktopOf(catalog, cloud.tier)?.name) ?? (cloud.placement === "shared" ? "Shared" : "Dedicated");
}

export function workspaceIcon(w: Pick<WorkspaceSummary, "kind">, cloud: CloudDesktop | null, size = 18) {
  const p = { size, strokeWidth: 1.5, "aria-hidden": true } as const;
  return cloud ? <Cloud {...p} /> : w.kind === "mac" ? <Laptop {...p} /> : <Server {...p} />;
}

/** power: asleep or off wakes at once; turning off asks first, since bots stop answering */
export function PowerButton({ cloud, size = "sm" }: { cloud: CloudDesktop; size?: "sm" | "md" }) {
  const { power } = useCloud();
  const { toast } = useSession();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  if (cloud.status === "provisioning") return null;
  const on = cloud.status === "running" || cloud.status === "error";
  const go = async (next: boolean) => {
    setBusy(true); setAsking(false);
    try { await power(cloud.id, next); toast(next ? `Waking ${cloud.name}` : `${cloud.name} is going to sleep`); } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  };
  return (
    <>
      <Button size={size} variant={on ? "outline" : "primary"} disabled={busy} onClick={() => (on ? setAsking(true) : void go(true))}>
        <Power size={15} strokeWidth={1.75} aria-hidden />{busy ? (on ? "Sleeping" : "Waking") : on ? "Sleep" : "Wake"}
      </Button>
      <Modal open={asking} onClose={() => setAsking(false)} title={`Put ${cloud.name} to sleep?`} footer={<><Button onClick={() => setAsking(false)}>Keep it on</Button><Button variant="primary" onClick={() => void go(false)}>Sleep</Button></>}>
        Your bots stop answering and their routines wait until you wake it again. Nothing on it is lost.
      </Modal>
    </>
  );
}

export function Provisioning({ cloud }: { cloud: CloudDesktop }) {
  const v = Math.round((cloud.progress?.value ?? 0) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-14">
        <span className="text-ink-2" aria-live="polite">{cloud.progress?.step ?? "Getting ready"}</span>
        <span className="num text-ink-3">{v}%</span>
      </div>
      <div className="relative mt-3 h-1 overflow-hidden rounded-full bg-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label="Setting up your cloud desktop">
        <div className="bar-fill h-full w-full rounded-full bg-ink" style={{ transform: `scaleX(${Math.max(0.03, v / 100)})` }} />
        <div className="sweep absolute inset-y-0 left-0 w-1/3 bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--bg)_45%,transparent),transparent)]" aria-hidden />
      </div>
    </div>
  );
}

/** the cloud desktop on its own: three sizes and one button; no license is bundled in */
export function QuickPick({ catalog, className, onDone, secondary }: { catalog: PlanCatalog; className?: string; onDone?(): void | Promise<void>; secondary?: ReactNode }) {
  const { checkout } = useCloud();
  const { toast } = useSession();
  const [pick, setPick] = useState<Exclude<DesktopId, "none">>(catalog.desktops.find((d) => d.id === "shared-m")?.id ?? catalog.desktops[0]?.id ?? "shared-s");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = desktopOf(catalog, pick);
  const selection: Selection = { license: "personal", members: 1, desktop: pick, size: null, region: catalog.regions[0]?.id ?? "", interval: "month" };
  const go = async () => {
    if (!chosen) return;
    setBusy(true); setError(null);
    try {
      if (await checkout({ kind: "plan", selection, bundle: null })) {
        toast("Paid. Your cloud desktop is being set up.");
        if (onDone) await onDone(); else navigate("/cloud");
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className={className}>
      <fieldset className="min-w-0">
        <legend className="sr-only">Cloud desktop size</legend>
        <div className="flex flex-col gap-1">
          {catalog.desktops.map((d) => (
            <Choice key={d.id} name="quick-desktop" value={d.id} checked={d.id === pick} onChange={() => setPick(d.id)} title={d.name} detail={`${botsLine(d.botComputers)} · ${specLine(d)}`} aside={<>{dollars(desktopMonthly(d, null, catalog.custom))}<span className="text-ink-3">/mo</span></>} />
          ))}
        </div>
      </fieldset>
      <p className="mt-4 text-13 text-ink-3">On 24/7, cancel any time. A work license is separate, in Plans & billing.</p>
      {error && <p role="alert" className="mt-2 text-13 text-bad">{error}</p>}
      <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
        {secondary}
        <Button variant="primary" onClick={() => void go()} disabled={busy || !chosen}>{busy ? "Opening checkout" : `Continue, ${dollars(chosen ? desktopMonthly(chosen, null, catalog.custom) : 0)}/mo`}</Button>
      </div>
    </div>
  );
}

/** the plan pick in a dialog, opened from the cloud pitch's one button */
export function PlanDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { catalog } = useCloud();
  return (
    <Modal open={open} onClose={onClose} title="Get a cloud desktop" wide>
      {catalog ? <QuickPick catalog={catalog} className="mt-3" onDone={() => { onClose(); navigate("/cloud"); }} secondary={<ButtonLink to="/billing#cloud" variant="ghost">See plans</ButtonLink>} /> : <Skeleton className="mt-3 h-[200px]" />}
    </Modal>
  );
}

/** the one cloud pitch: a line, a sentence, one button and the three mascots; home, the empty cloud page and billing share it */
export function CloudPitch({ title = "Keep your bots on while your Mac sleeps", body = "A cloud desktop runs them all day and all night. Set up in one click.", action, link = { to: "/billing", label: "See plans" }, className, id = "pitch-title" }: { title?: string; body?: ReactNode; action?: ReactNode | false; link?: { to: string; label: string } | null; className?: string; id?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={cx("enter flex items-center gap-8 rounded-card bg-card px-8 py-7 max-sm:flex-col-reverse max-sm:items-start max-sm:gap-5 max-sm:p-5", className)} aria-labelledby={id}>
      <div className="min-w-0 flex-1">
        <h2 id={id} className="text-20 font-semibold tracking-[-0.015em] text-ink">{title}</h2>
        <p className="mt-1.5 max-w-[52ch] text-14 leading-[1.55] text-ink-3">{body}</p>
        {(action !== false || link) && (
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
            {action === false ? null : action ?? <Button variant="primary" onClick={() => setOpen(true)}>Get a cloud desktop</Button>}
            {link && <Link to={link.to} className="hover-link inline-flex h-9 items-center text-14 text-ink-3 max-sm:h-11">{link.label}</Link>}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-end gap-1 pe-2" aria-hidden>
        <Mascot color="orange" size={36} />
        <span className="mb-3 inline-flex"><Mascot color="blue" size={48} /></span>
        <Mascot color="green" size={36} />
      </div>
      {action === undefined && <PlanDialog open={open} onClose={() => setOpen(false)} />}
    </section>
  );
}
