import { useState } from "react";
import { Check } from "@/icons";
import { useCloud } from "../data/cloud";
import type { CheckoutSource, PlanCatalog } from "../data/contracts";
import { bundleOf, dollars } from "../data/pricing";
import { useSession } from "../data/session";
import { cx } from "../ui/kit";
import { planSelection, type PaidPlan } from "./plan-sheet";

/** what dusk cloud does for someone, said the same way everywhere it is offered */
export const CLOUD_POINTS = [
  "always available, even with your laptop shut",
  "routines run on time, day and night",
  "text your bots from your phone, any time",
  "ready in a minute, nothing to install",
] as const;

export function Points({ className }: { className?: string }) {
  return (
    <ul className={cx("flex flex-col gap-2", className)}>
      {CLOUD_POINTS.map((p) => (
        <li key={p} className="flex gap-2.5 text-14 leading-[1.45] text-ink-2">
          <Check size={17} strokeWidth={2} className="mt-0.5 shrink-0 text-good" aria-hidden />{p}
        </li>
      ))}
    </ul>
  );
}

export const CHECKOUT_SOON = "paid plans open soon. your account is ready, and we'll email you when checkout opens.";

/** checkout for a plan in one click: monthly, the first region, personal use; the plans page has every option */
export function useQuickCheckout(source: CheckoutSource) {
  const { catalog, checkout } = useCloud();
  const { toast } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buy = async (plan: PaidPlan = "starter") => {
    if (!catalog) return;
    if (catalog.checkoutOpen === false) { setError(CHECKOUT_SOON); return; }
    setBusy(true); setError(null);
    const ok = await checkout({ source, kind: "plan", selection: planSelection(catalog, plan, { interval: "month", work: false }), bundle: null });
    if (ok) toast("paid. your dusk cloud is being set up.");
    else setError("checkout didn't open. try again.");
    setBusy(false);
  };
  return { busy, error, buy };
}

export const monthlyOf = (catalog: PlanCatalog | null, plan: PaidPlan) => {
  const b = catalog ? bundleOf(catalog, plan) : null;
  return b ? dollars(b.monthly) : null;
};
