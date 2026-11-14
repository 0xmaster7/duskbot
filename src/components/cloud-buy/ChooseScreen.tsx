// Screen 1: the one reason to buy over the night card, what every plan does said once, then the plans as one choice
// (name, who it is for, price; the picked plan's machine in a small line) and one button that names it. The money once, under it.
import { useState } from "react";
import type { CloudOffer, CloudOfferPlan } from "../../../electron/cloud-home.mjs";
import { Archive, CalendarClock, MonitorSmartphone } from "../../icons";
import { cn } from "@/lib/cn";
import { moneyBackShort, planCards, sharedPerks, type CloudPlanCard } from "@/lib/cloud-plan";
import { t } from "@/lib/i18n";
import { NightCard } from "./NightCard";
import { LINK, PRIMARY_WIDE, SCREEN, Tag } from "./parts";

const PERK_ICON = { routines: CalendarClock, anywhere: MonitorSmartphone, backups: Archive } as const;

/** The plan picked first: the Admin's recommended one, else the first the person can buy. */
function firstPick(cards: readonly CloudPlanCard[]): string | null {
  return (cards.find(card => card.popular && card.action) ?? cards.find(card => card.action))?.tier ?? null;
}

/** One plan as a radio row: the whole row picks it, arrow keys move between them; the person's own plan is shown, not picked. */
function PlanRow({ card, picked, onPick }: { card: CloudPlanCard; picked: boolean; onPick: (tier: string) => void }) {
  const nameId = `cloud-plan-${card.tier}`;
  return <li data-plan={card.tier} data-plan-current={card.current ? "" : undefined}>
    <label className={cn("grid min-h-[52px] grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-[12px] px-4 py-2 transition-colors duration-150 ease-out motion-reduce:transition-none",
      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus",
      card.current ? "cursor-default" : picked ? "bg-menu" : "cursor-pointer hover:bg-ink/[0.04]")}>
      <input type="radio" name="cloud-plan" value={card.tier} data-plan-pick={card.tier} aria-labelledby={nameId} aria-describedby={`${nameId}-for`}
        checked={picked} disabled={card.current} onChange={() => onPick(card.tier)} className="peer sr-only" />
      <span aria-hidden="true" className={cn("grid size-[18px] place-items-center rounded-full transition-colors duration-150 motion-reduce:transition-none",
        picked ? "bg-ink" : "bg-ink/[0.1]", card.current && "opacity-0")}>
        <span className={cn("size-1.5 rounded-full bg-app", !picked && "opacity-0")} />
      </span>
      <span className="min-w-0">
        <span id={nameId} className="block text-[15px] font-medium leading-5 text-ink">{card.name}</span>
        {card.promise && <span id={`${nameId}-for`} data-plan-promise="" className="block truncate text-[13px] leading-[18px] text-ink-secondary">{card.promise}</span>}
      </span>
      {card.current
        ? <Tag data-plan-mine="">{t("cloudBuy.card.current")}</Tag>
        : <span className="flex flex-col items-end">
          <span className="text-[15px] leading-5 tabular-nums text-ink">{card.price}<span className="text-[13px] text-ink-tertiary">{t("cloudBuy.perMonth")}</span></span>
          {card.trialDays && <span data-plan-trial="" className="text-[12px] leading-4 text-ink-secondary">{t("cloudBuy.card.trialShort", { days: card.trialDays })}</span>}
        </span>}
    </label>
  </li>;
}

export function ChooseScreen({ offer, current = null, own = null, busy, signedOut, notice, pending = null, onStart, onSignIn, onResume }: {
  offer: CloudOffer;
  /** The person's own plan tier, and that plan when it is no longer on sale: its row says Your plan and cannot be picked. */
  current?: string | null; own?: CloudOfferPlan | null;
  now?: number; busy: boolean; signedOut: boolean; notice: string | null;
  /** A checkout left open: its plan's name, for a quiet Finish your checkout beside the terms. */
  pending?: string | null;
  onStart: (tier: string) => void; onSignIn: () => void; onResume?: () => void;
}) {
  const cards = planCards(offer, { current, own });
  const [chosen, setChosen] = useState<string | null>(null);
  const pick = cards.find(card => card.tier === chosen && card.action) ?? cards.find(card => card.tier === firstPick(cards)) ?? null;
  const trial = offer.plans.some(plan => plan.trialDays);
  const moneyBack = moneyBackShort(offer);
  const perks = sharedPerks(offer);
  const buy = pick && (pick.trialDays
    ? t(pick.trialDays === 1 ? "cloudBuy.buyTrial.one" : "cloudBuy.buyTrial.many", { plan: pick.name, days: pick.trialDays })
    : t("cloudBuy.buy", { plan: pick.name, price: pick.price }));
  return <div data-cloud-add={trial ? "offer-trial" : "offer"} className={SCREEN}>
    <div className="-mx-4 -mt-3">
      <NightCard className="[@media(max-height:600px)]:h-[100px]">
        <p className="text-[13px] leading-[18px] text-(--cloud-night-ink-quiet)">{t("pro.name")}</p>
        <h2 id="cloud-add-title" tabIndex={-1}
          className="mt-1 max-w-[min(300px,56%)] text-[19px] font-medium leading-6 tracking-[-0.01em] outline-none! [text-wrap:balance]">{t("cloudBuy.headline")}</h2>
      </NightCard>
    </div>
    <ul data-plan-perks="" className="flex flex-wrap justify-between gap-x-4 gap-y-2 px-0.5">
      {perks.map(perk => {
        const Icon = PERK_ICON[perk.key];
        return <li key={perk.key} data-plan-perk={perk.key} className="flex items-center gap-2 text-[13px] leading-[18px] text-ink-secondary">
          <Icon size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-tertiary" />{perk.text}
        </li>;
      })}
    </ul>
    {notice && <p role="status" className="text-[13px] leading-[18px] text-ink">{notice}</p>}
    <section aria-labelledby="cloud-add-plans" className="flex flex-col gap-3">
      <h3 id="cloud-add-plans" className="sr-only">{t("cloudBuy.choose")}</h3>
      <ul role="radiogroup" aria-labelledby="cloud-add-plans" className="-mx-1.5 flex flex-col gap-1 rounded-[16px] bg-ink/[0.03] p-1.5">
        {cards.map(card => <PlanRow key={card.tier} card={card} picked={card.tier === pick?.tier} onPick={setChosen} />)}
      </ul>
      {pick?.spec && <p data-plan-spec={pick.tier} aria-live="polite" className="px-2.5 text-[12px] leading-4 tabular-nums text-ink-tertiary">{pick.spec}</p>}
    </section>
    <div className="flex flex-col gap-3">
      {pick && buy && <button type="button" data-plan-buy={pick.tier} className={PRIMARY_WIDE} disabled={busy} onClick={() => onStart(pick.tier)}>{buy}</button>}
      <div aria-live="polite" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 text-[12px] leading-4 text-ink-tertiary">
        <p data-plan-terms="">{t(trial ? "cloudBuy.termsTrial" : "cloudBuy.terms")}{moneyBack && <> {t("cloudBuy.moneyBackLine", { days: offer.refundDays! })}</>}</p>
        {signedOut && <button type="button" className={LINK} onClick={onSignIn}>{t("cloudBuy.haveAccount")}</button>}
        {!signedOut && pending && onResume && <button type="button" data-plan-pending="" className={LINK} disabled={busy} onClick={onResume}>{t("cloudBuy.pending", { plan: pending })}</button>}
      </div>
    </div>
  </div>;
}
