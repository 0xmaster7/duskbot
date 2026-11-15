// Screen 1: the one reason to buy, the plans as tabs, the picked plan's price as one big pixel number with what it is for
// and its machine beside it, and one button that names it. The money once, under it.
import { useState, type KeyboardEvent } from "react";
import type { CloudOffer, CloudOfferPlan } from "../../../electron/cloud-home.mjs";
import { cn } from "@/lib/cn";
import { moneyBackShort, planCards, usd, type CloudPlanCard } from "@/lib/cloud-plan";
import { activeLocale, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { buyLabel } from "./buy-label";
import { LINK, PRIMARY, Tag } from "./parts";
import { PixelPrice, pixelPriceFits, pixelPriceUnits } from "./PixelPrice";

const WHY: Record<string, LocaleKey> = { starter: "cloudBuy.big.why.starter", pro: "cloudBuy.big.why.pro", team: "cloudBuy.big.why.team" };
const WORK = new Set(["pro", "max"]);
/** the widest price fits this many px; every plan's price is drawn at the same size so only digits move between tabs */
const PRICE_WIDTH = 304;

/** The plan picked first: the Admin's recommended one, else the first the person can buy. */
function firstPick(cards: readonly CloudPlanCard[]): string | null {
  return (cards.find(card => card.popular && card.action) ?? cards.find(card => card.action))?.tier ?? null;
}

const gb = (mb: number) => new Intl.NumberFormat(activeLocale(), { maximumFractionDigits: 1 }).format(Math.round(mb / 102.4) / 10);
/** The picked plan's four lines, every number from the Admin's allowances: machine, disk, how it wakes, who may use it.
 * `oldAdmin`: an Admin that says nothing of sleeping or seats, so Plus wakes in seconds and Team's seats are its catalog's. */
function specs(plan: CloudOfferPlan | undefined, oldAdmin: boolean): Array<{ key: string; text: string; quiet?: true }> {
  const a = plan?.allowances;
  if (!plan || !a) return [];
  const team = plan.tier === "team" || Boolean(a.seats);
  const cpus = t("cloudBuy.plan.cpus", { count: a.cpus });
  const sleeps = a.sleeps === true || (oldAdmin && plan.tier === "starter");
  return [
    { key: "machine", text: t(team ? "cloudBuy.big.machineDedicated" : "cloudBuy.big.machine", { cpus, memory: gb(a.memoryMb) }) },
    { key: "disk", text: a.maxDiskGb > a.diskGb ? t("cloudBuy.row.storageGrows", { gb: a.diskGb, max: a.maxDiskGb }) : t("cloudBuy.row.storage", { gb: a.diskGb }) },
    { key: "wake", text: t(sleeps ? "cloudBuy.big.wakes" : "cloudBuy.big.priority") },
    a.seats && a.includedSeats && a.extraSeatCents
      ? { key: "license", text: t("cloudBuy.big.seats", { included: a.includedSeats, price: usd(a.extraSeatCents / 100), seats: a.seats }) }
      : a.seats ? { key: "license", text: t("cloudBuy.point.team", { seats: a.seats }) }
      : team ? { key: "license", text: t("cloudBuy.big.teamSeats") }
      : WORK.has(plan.tier) ? { key: "license", text: t("cloudBuy.big.workLicense") }
      : { key: "license", text: t("cloudBuy.big.noLicense"), quiet: true },
  ];
}

/** Arrow keys, Home and End move between the plans a person can pick, and pick them. */
function moveFocus(event: KeyboardEvent<HTMLButtonElement>, pickable: readonly string[], tier: string, onPick: (tier: string) => void) {
  const at = pickable.indexOf(tier), last = pickable.length - 1;
  const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
  const step: Record<string, number> = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 };
  const to = event.key === "Home" ? 0 : event.key === "End" ? last : event.key in step ? (Math.max(at, 0) + step[event.key]! + pickable.length) % pickable.length : -1;
  if (to < 0 || !pickable.length) return;
  event.preventDefault();
  onPick(pickable[to]!);
  event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-plan-pick="${pickable[to]}"]`)?.focus();
}

export function ChooseScreen({ offer, current = null, own = null, busy, signedOut, notice, pending = null, onStart, onSignIn, onResume }: {
  offer: CloudOffer;
  /** The person's own plan tier, and that plan when it is no longer on sale: its tab says Your plan and cannot be picked. */
  current?: string | null; own?: CloudOfferPlan | null;
  now?: number; busy: boolean; signedOut: boolean; notice: string | null;
  /** A checkout left open: its plan's name, for a quiet Finish your checkout beside the terms. */
  pending?: string | null;
  onStart: (tier: string) => void; onSignIn: () => void; onResume?: () => void;
}) {
  const cards = planCards(offer, { current, own });
  const [chosen, setChosen] = useState<string | null>(null);
  const pick = cards.find(card => card.tier === chosen && card.action) ?? cards.find(card => card.tier === firstPick(cards)) ?? null;
  const pickable = cards.filter(card => card.action).map(card => card.tier);
  const trial = offer.plans.some(plan => plan.trialDays);
  const moneyBack = moneyBackShort(offer);
  const plan = pick ? [...offer.plans, ...(own ? [own] : [])].find(entry => entry.tier === pick.tier) : undefined;
  const lines = specs(plan, !offer.plans.some(entry => entry.allowances?.sleeps || entry.allowances?.seats));
  const pixel = cards.every(card => pixelPriceFits(card.price));
  const unit = Math.max(6, Math.min(10, Math.floor(PRICE_WIDTH / Math.max(...cards.map(card => pixelPriceUnits(card.price))))));
  const buy = pick && (pick.trialDays
    ? t(pick.trialDays === 1 ? "cloudBuy.buyTrial.one" : "cloudBuy.buyTrial.many", { plan: pick.name, days: pick.trialDays })
    : buyLabel(pick.name, pick.price));
  return <div data-cloud-add={trial ? "offer-trial" : "offer"} className="cloud-plans flex flex-col gap-6 px-7 pb-7 pt-6">
    <header className="flex flex-col gap-1 pe-12">
      <p className="text-[13px] leading-[18px] text-ink-tertiary">{t("pro.name")}</p>
      <h2 id="cloud-add-title" tabIndex={-1} className="text-[21px] font-medium leading-[27px] tracking-[-0.014em] text-ink outline-none! [text-wrap:balance]">{t("cloudBuy.headline")}</h2>
    </header>
    {notice && <p role="status" className="-mt-2 text-[13px] leading-[18px] text-ink">{notice}</p>}
    <div role="tablist" aria-label={t("cloudBuy.choose")} className="cloud-plans-tabs grid auto-cols-fr grid-flow-col gap-1 p-1">
      {cards.map(card => {
        const on = card.tier === pick?.tier;
        return <button key={card.tier} type="button" role="tab" id={`cloud-plan-${card.tier}`} data-plan={card.tier} data-plan-pick={card.tier}
          data-plan-current={card.current ? "" : undefined} aria-selected={on} aria-controls="cloud-plan-panel" aria-disabled={card.current || undefined}
          tabIndex={on ? 0 : -1} onClick={() => card.action && setChosen(card.tier)} onKeyDown={event => moveFocus(event, pickable, card.tier, setChosen)}
          className="cloud-plans-tab flex h-11 min-w-0 items-center justify-center gap-2 px-2 text-[14px] font-medium">
          <span className="truncate">{card.name}</span>
          {card.current ? <Tag data-plan-mine="">{t("cloudBuy.card.current")}</Tag>
            : WORK.has(card.tier) && <span className={cn("cloud-plans-tag shrink-0 px-1.5 pb-[3px] pt-px text-[11px] font-medium leading-4", on ? "bg-ink/[0.04]" : "bg-app/70")}>{t("cloudBuy.big.forWork")}</span>}
        </button>;
      })}
    </div>
    {pick && <div role="tabpanel" id="cloud-plan-panel" aria-labelledby={`cloud-plan-${pick.tier}`} data-plan-shown={pick.tier}
      className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-6">
      <div className="flex flex-col gap-2">
        {pixel ? <PixelPrice price={pick.price} unit={unit} label={t("cloudBuy.big.priceLabel", { price: pick.price })} />
          : <p className="text-[56px] font-medium leading-none tracking-[-0.04em] tabular-nums text-ink">{pick.price}</p>}
        <p aria-hidden="true" data-plan-trial={pick.trialDays ? "" : undefined} className="text-[13px] leading-4 text-ink-tertiary">
          {pick.trialDays ? t("cloudBuy.big.perMonthTrial", { days: pick.trialDays, plan: pick.name }) : t("cloudBuy.big.perMonth", { plan: pick.name })}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-3 pb-1">
        {(Object.hasOwn(WHY, pick.tier) || pick.promise) && <p data-plan-promise="" className="text-[15px] font-medium leading-5 text-ink [text-wrap:pretty]">
          {Object.hasOwn(WHY, pick.tier) ? t(WHY[pick.tier]!) : pick.promise}</p>}
        {lines.length > 0 && <ul data-plan-spec={pick.tier} className="flex flex-col gap-1 text-[13px] leading-[18px] text-ink">
          {lines.map(line => <li key={line.key} data-plan-line={line.key} className={cn("[text-wrap:pretty]", line.quiet && "text-ink-tertiary")}>{line.text}</li>)}
        </ul>}
      </div>
    </div>}
    <div className="flex flex-col gap-3">
      {pick && buy && <button type="button" data-plan-buy={pick.tier} className={cn(PRIMARY, "cloud-plans-buy w-full")} disabled={busy} onClick={() => onStart(pick.tier)}>{buy}</button>}
      <div aria-live="polite" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 text-[12px] leading-4 text-ink-tertiary">
        <p data-plan-terms="">{t(trial ? "cloudBuy.termsTrial" : "cloudBuy.terms")}{moneyBack && <> {t("cloudBuy.moneyBackLine", { days: offer.refundDays! })}</>}</p>
        {signedOut && <button type="button" className={cn(LINK, "text-[12px]")} onClick={onSignIn}>{t("cloudBuy.haveAccount")}</button>}
        {!signedOut && pending && onResume && <button type="button" data-plan-pending="" className={cn(LINK, "text-[12px]")} disabled={busy} onClick={onResume}>{t("cloudBuy.pending", { plan: pending })}</button>}
      </div>
    </div>
  </div>;
}
