// Screen 1: dusk cloud in a line, then the plans the Admin sells now as cards: name, price, one line, the machine and
// one button each (the recommended plan's the primary one). The money is said once, under them.
import type { CloudOffer, CloudOfferPlan } from "../../../electron/cloud-home.mjs";
import { cn } from "@/lib/cn";
import { cardRows, moneyBackShort, planCards, type CloudPlanCard, type CloudPlanCardRow } from "@/lib/cloud-plan";
import { t } from "@/lib/i18n";
import { NightCard } from "./NightCard";
import { LINK, PRIMARY_WIDE, QUIET_WIDE, SCREEN } from "./parts";

/** Cards side by side on a wide sheet, written out for Tailwind to find. */
const COLUMNS: Record<number, string> = { 1: "md:grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-2 lg:grid-cols-4" };

/** On a wide sheet the cards share their rows (a subgrid), so every card's price, line, numbers and button line up. */
function PlanCard({ card, shown, trialDays, busy, onStart }: {
  card: CloudPlanCard; shown: CloudPlanCardRow[]; trialDays: number | null; busy: boolean; onStart: (tier: string) => void;
}) {
  const nameId = `cloud-plan-${card.tier}`;
  const power = shown.find(row => row.key === "power");
  const specs = shown.filter(row => row.key !== "power").map(row => row.text).join(" · ");
  return <li data-plan={card.tier} aria-labelledby={nameId} data-plan-current={card.current ? "" : undefined}
    className="grid min-w-0 grid-rows-subgrid gap-y-3 rounded-[14px] bg-menu p-5 row-span-4">
    <div className="flex flex-col gap-1">
      <h4 id={nameId} className="text-[15px] font-medium leading-[22px] text-ink">{card.name}</h4>
      <p className="flex flex-wrap items-baseline gap-x-1">
        <span className="text-[28px] font-semibold leading-8 tracking-[-0.02em] tabular-nums text-ink">{card.price}</span>
        <span className="text-[13px] text-ink-tertiary">{t("cloudBuy.perMonth")}</span>
        {trialDays && <span data-plan-trial="" className="ms-1 text-[13px] text-ink-secondary">{t("cloudBuy.card.trialShort", { days: trialDays })}</span>}
      </p>
    </div>
    {card.promise ? <p data-plan-promise="" className="text-[13px] leading-[18px] text-ink-secondary [text-wrap:pretty]">{card.promise}</p> : <span />}
    <div className="flex flex-col gap-0.5 text-[12px] leading-4 tabular-nums text-ink-tertiary">
      {specs && <p data-plan-row="machine">{specs}</p>}
      {power && <p data-plan-row="power">{power.text}</p>}
    </div>
    {card.action
      ? <button type="button" data-plan-buy={card.tier} aria-describedby={nameId} className={cn(card.popular ? PRIMARY_WIDE : QUIET_WIDE, "self-end")} disabled={busy}
        onClick={() => onStart(card.tier)}>{card.action}</button>
      : <p data-plan-mine="" className="grid min-h-9 place-items-center self-end rounded-full bg-ink/[0.04] px-4 text-[14px] text-ink-secondary">{t("cloudBuy.card.current")}</p>}
  </li>;
}

export function ChooseScreen({ offer, current = null, own = null, busy, signedOut, notice, onStart, onSignIn }: {
  offer: CloudOffer;
  /** The person's own plan tier, and that plan when it is no longer on sale: its card says Your plan instead of a button. */
  current?: string | null; own?: CloudOfferPlan | null;
  now?: number; busy: boolean; signedOut: boolean; notice: string | null;
  onStart: (tier: string) => void; onSignIn: () => void;
}) {
  const cards = planCards(offer, { current, own });
  const rows = cardRows(cards);
  const trial = offer.plans.some(plan => plan.trialDays);
  const trialOf = (tier: string) => offer.plans.find(plan => plan.tier === tier)?.trialDays ?? null;
  const moneyBack = moneyBackShort(offer);
  return <div data-cloud-add={trial ? "offer-trial" : "offer"} className={SCREEN}>
    <div className="-mx-4 -mt-3">
      <NightCard>
        <h2 id="cloud-add-title" tabIndex={-1} className="text-[17px] font-medium leading-6 tracking-[-0.008em] outline-none!">{t("pro.name")}</h2>
        <p className="mt-0.5 max-w-[min(420px,52%)] text-[14px] leading-5 text-(--cloud-night-ink-quiet) [text-wrap:pretty]">{t("cloudBuy.lede")}</p>
      </NightCard>
    </div>
    {notice && <p role="status" className="text-[13px] leading-[18px] text-ink">{notice}</p>}
    <section aria-labelledby="cloud-add-plans">
      <h3 id="cloud-add-plans" className="sr-only">{t("cloudBuy.choose")}</h3>
      <ul aria-labelledby="cloud-add-plans" className={cn("grid gap-3", COLUMNS[cards.length] ?? "md:grid-cols-3")}>
        {cards.map((card, index) => <PlanCard key={card.tier} card={card} shown={rows[index]!.shown} trialDays={card.current ? null : trialOf(card.tier)} busy={busy} onStart={onStart} />)}
      </ul>
    </section>
    <div aria-live="polite" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 text-[12px] leading-4 text-ink-tertiary">
      <p data-plan-terms="">{t(trial ? "cloudBuy.termsTrial" : "cloudBuy.terms")}{moneyBack && <> {t("cloudBuy.moneyBackLine", { days: offer.refundDays! })}</>}</p>
      {signedOut && <button type="button" className={LINK} onClick={onSignIn}>{t("cloudBuy.haveAccount")}</button>}
    </div>
  </div>;
}
