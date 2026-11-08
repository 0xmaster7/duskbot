import { useState, type ReactNode } from "react";
import { Cloud, Laptop, Power, Server } from "lucide-react";
import type { WorkspaceSummary } from "../../../shared/dashboard-protocol";
import { useCloud } from "../data/cloud";
import type { BundleId, CloudDesktop, PlanCatalog } from "../data/contracts";
import { bundleOf, desktopOf, dollars, priceCart, selectionFor, specLine } from "../data/pricing";
import { useSession } from "../data/session";
import { duration } from "../lib/format";
import { navigate } from "../lib/router";
import { Modal, StatusDot } from "../ui/controls";
import { Button, ButtonLink, cx } from "../ui/kit";

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
      <p className="mt-3 text-13 text-ink-4">About a minute. You can leave this page; it keeps going.</p>
    </div>
  );
}

const QUICK: BundleId[] = ["starter", "pro", "team"];

/** the plan pick inside a pitch: three bundles, one primary that goes straight to checkout */
export function QuickPick({ catalog, className, onDone, secondary }: { catalog: PlanCatalog; className?: string; onDone?(): void | Promise<void>; secondary?: ReactNode }) {
  const { checkout } = useCloud();
  const { toast } = useSession();
  const [pick, setPick] = useState<BundleId>(catalog.bundles.find((b) => b.recommended)?.id ?? "pro");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bundles = QUICK.map((id) => bundleOf(catalog, id)).filter((b): b is NonNullable<typeof b> => Boolean(b));
  const chosen = bundleOf(catalog, pick);
  const go = async () => {
    if (!chosen) return;
    setBusy(true); setError(null);
    const selection = selectionFor(chosen, catalog, "month", catalog.regions[0]?.id ?? "");
    try {
      if (await checkout({ kind: "plan", selection, bundle: chosen.id })) {
        toast("Paid. Your cloud desktop is being set up.");
        if (onDone) await onDone(); else navigate("/cloud");
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className={className}>
      <div role="radiogroup" aria-label="Cloud desktop plan" className="grid grid-cols-3 gap-2">
        {bundles.map((b) => {
          const desk = desktopOf(catalog, b.desktop);
          const on = b.id === pick;
          return (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setPick(b.id)}
              className={cx("press-soft pick min-w-0 rounded-[14px] border px-3.5 py-3 text-start", on ? "border-ink-3 bg-card-2" : "hover-pick border-line-2")}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-13 font-medium text-ink">{b.name}</span>
                {b.recommended && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="Recommended" role="img" />}
              </span>
              <span className="num mt-1 block text-20 font-medium tracking-[-0.01em] text-ink">{dollars(b.monthly)}<span className="text-13 font-normal text-ink-3">/mo</span></span>
              <span className="mt-0.5 block text-12 leading-[1.35] text-ink-3">{desk ? `${desk.botComputers === null ? "Unlimited" : desk.botComputers} bot computers` : ""}</span>
            </button>
          );
        })}
      </div>
      {chosen && <p className="mt-3 text-13 leading-[1.5] text-ink-3">{chosen.features[0]} · {(() => { const d = desktopOf(catalog, chosen.desktop); return d ? specLine(d) : ""; })()}</p>}
      {error && <p role="alert" className="mt-2 text-13 text-bad">{error}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => void go()} disabled={busy || !chosen}>{busy ? "Opening checkout" : `Get ${chosen?.name ?? ""} for ${dollars(chosen ? priceCart(selectionFor(chosen, catalog, "month", ""), catalog).perMonth : 0)}/mo`}</Button>
        {secondary ?? <ButtonLink to="/billing">Compare plans</ButtonLink>}
      </div>
    </div>
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-6 items-center rounded-full border border-line-2 px-2.5 text-12 text-ink-2">{children}</span>;
}
