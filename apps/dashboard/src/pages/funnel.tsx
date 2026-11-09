import type { ReactNode } from "react";
import { Check, Minus } from "lucide-react";
import type { PlanCatalog } from "../data/contracts";
import { freeTradeoffs, type FunnelPlan } from "../data/funnel";
import { bundleOf, dollars } from "../data/pricing";
import { Modal } from "../ui/controls";
import { Button, cx } from "../ui/kit";
import { Mascot } from "../ui/Mascot";

/** three bots at work on their cloud desktop, the paid plans' picture */
export function CrewStage({ className }: { className?: string }) {
  return (
    <div className={cx("relative flex h-[156px] items-end justify-center overflow-hidden rounded-[10px] bg-bg max-sm:h-[128px]", className)} aria-hidden>
      <span className="absolute left-4 top-3.5 inline-flex items-center gap-2 text-12 text-ink-3"><span className="live-dot text-good" data-live />On 24/7</span>
      <span className="absolute inset-x-8 bottom-6 h-px bg-line-2" />
      <div className="relative flex items-end gap-3 pb-6">
        <Mascot color="orange" size={56} state="coding" />
        <span className="mb-4 inline-flex"><Mascot color="blue" size={76} state="working" /></span>
        <Mascot color="green" size={56} state="reading" />
      </div>
    </div>
  );
}

/** the honest comparison shown when someone picks Free: what changes, with Free one click away */
export function FreeSheet({ open, catalog, plan, onClose, onFree, primary, freeLabel = "Continue with Free", error }: { open: boolean; catalog: PlanCatalog; plan: FunnelPlan; onClose(): void; onFree(): void; primary: ReactNode; freeLabel?: string; error?: string | null }) {
  const b = bundleOf(catalog, plan);
  if (!b) return null;
  return (
    <Modal open={open} onClose={onClose} wide title="What Free leaves out" footer={<><Button onClick={onFree}>{freeLabel}</Button>{primary}</>}>
      <p>Free keeps every bot, chat and connector for personal use. Here is what changes without a cloud desktop.</p>
      <div className="mt-5 grid grid-cols-2 gap-x-5 border-b border-line pb-2.5 text-13" aria-hidden>
        <span className="text-ink-3">Free <span className="num">$0</span></span>
        <span className="font-medium text-ink">{b.name} <span className="num font-normal text-ink-3">{dollars(b.monthly)}/mo</span></span>
      </div>
      <ul className="divide-y divide-line">
        {freeTradeoffs(catalog, plan).map((r) => (
          <li key={r.topic} className="py-3">
            <p className="text-12 text-ink-3">{r.topic}</p>
            <div className="mt-1 grid grid-cols-2 gap-x-5 text-13 leading-[1.45]">
              <p className="flex gap-2 text-ink-3"><Minus size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-4" aria-hidden /><span><span className="sr-only">On Free: </span>{r.free}</span></p>
              <p className="flex gap-2 text-ink"><Check size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-good" aria-hidden /><span><span className="sr-only">On {b.name}: </span>{r.paid}</span></p>
            </div>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-3 text-13 text-bad">{error}</p>}
    </Modal>
  );
}
