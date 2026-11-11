import { investedBy, snoozed, snoozeUntil, UPSELL_EVENTS, type InvestedFacts, type UpsellStep } from "../../shared/cloud-upsell";
import { track } from "./analytics";
import { buyOfferAllowed, type CloudPlanView, type CloudSource } from "./cloud-plan";

type Usage = { turns: number } | null | undefined;
type BotFacts = { hidden?: boolean; movedTo?: unknown; tasks?: ReadonlyArray<{ usage?: Usage }> };

/** what this computer knows about how much someone uses dusk bot: their bots, the turns they and their rooms had, routines */
export function investedFacts(state: {
  bots: readonly BotFacts[]; groups: ReadonlyArray<{ usage?: Usage }>; routines?: readonly unknown[];
}): InvestedFacts {
  const bots = state.bots.filter(bot => !bot.hidden && !bot.movedTo);
  const turns = (usage: Usage) => usage?.turns ?? 0;
  const messages = bots.reduce((sum, bot) => sum + (bot.tasks ?? []).reduce((all, task) => all + turns(task.usage), 0), 0)
    + state.groups.reduce((sum, group) => sum + turns(group.usage), 0);
  return { bots: bots.length, messages, routines: state.routines?.length ?? 0 };
}

export const isInvested = (state: Parameters<typeof investedFacts>[0]) => investedBy(investedFacts(state)) !== null;

const stored = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch {} };

export const SIDEBAR_CARD_KEY = "omb-cloud-sidebar-card-until";
export const sidebarCardSnoozed = (now = Date.now()) => snoozed(stored(SIDEBAR_CARD_KEY), now);
export const snoozeSidebarCard = (now = Date.now()) => store(SIDEBAR_CARD_KEY, String(snoozeUntil(now)));

/** the 24/7 pitch, inline in a routine's form or after one is made: one cooldown, so it is never said twice in a row */
export const ALWAYS_ON_KEY = "omb-routine-cloud-upsell-at";
export const ALWAYS_ON_COOLDOWN = 30 * 86_400_000;
export function alwaysOnCooling(now = Date.now()): boolean {
  const last = Number(stored(ALWAYS_ON_KEY)) || 0;
  return last > 0 && now - last < ALWAYS_ON_COOLDOWN;
}
export const markAlwaysOn = (now = Date.now()) => store(ALWAYS_ON_KEY, String(now));

export function trackUpsell(step: UpsellStep, source: CloudSource | "app_mobile"): void {
  track(UPSELL_EVENTS[step], { source });
}

/** may this page offer dusk cloud: only this computer's own page, to someone who could buy it (signed out or free) and is not
 * in an organization; null while the plan or the organization is still loading */
export function cloudUpsellAllowed({ here, view, managed }: { here: boolean; view: CloudPlanView | null; managed: boolean | null }): boolean | null {
  if (!here || !view || managed === true) return false;
  if (managed === null || view.kind === "unknown" || view.kind === "connecting") return null;
  return buyOfferAllowed(view);
}
