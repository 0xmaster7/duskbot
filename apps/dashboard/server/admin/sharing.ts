import type { StoredEvent } from "../analytics/sink.ts";

const DAY = 86_400_000;
export const SHARING_EVENT = "usage_sharing";
export const SHARING_LOOKBACK_DAYS = 90;
const ACTIVE_DAYS = 30;
const PLACES = ["settings", "first_run"] as const;
type Place = typeof PLACES[number];

export interface SharingWindow { days: 7 | 30; enables: number; disables: number; byPlace: Record<Place, { enables: number; disables: number }> }
export interface SharingAnswer {
  v: 1;
  now: number;
  /** installs that sent anything in the last 30 days and whose newest switch, if any, is on */
  optedIn: number;
  /** installs whose newest switch in the lookback is off; they send nothing after it, so they are counted from that event */
  optedOut: number;
  /** optedOut of everyone counted, null with nobody */
  outShare: number | null;
  windows: SharingWindow[];
}

const whoOf = (event: StoredEvent) => event.ctx?.install ?? event.accountId;
const isSwitch = (event: StoredEvent) => event.name === "app_action" && event.props.name === SHARING_EVENT && typeof event.props.on === "boolean";
const placeOf = (event: StoredEvent): Place => (event.props.where === "first_run" ? "first_run" : "settings");

export function sharingOf(events: readonly StoredEvent[], now: number): SharingAnswer {
  const latest = new Map<string, { at: number; on: boolean }>();
  const active = new Set<string>();
  for (const event of events) {
    const who = whoOf(event);
    if (!who) continue;
    if (isSwitch(event)) {
      const seen = latest.get(who);
      if (!seen || event.at >= seen.at) latest.set(who, { at: event.at, on: event.props.on === true });
    }
    if (event.at >= now - ACTIVE_DAYS * DAY) active.add(who);
  }
  let optedOut = 0;
  for (const state of latest.values()) if (!state.on) optedOut++;
  let optedIn = 0;
  for (const who of active) if (latest.get(who)?.on !== false) optedIn++;
  const windows = ([7, 30] as const).map((days): SharingWindow => {
    const byPlace = { settings: { enables: 0, disables: 0 }, first_run: { enables: 0, disables: 0 } };
    for (const event of events) {
      if (!isSwitch(event) || event.at < now - days * DAY || event.at > now) continue;
      const tally = byPlace[placeOf(event)];
      if (event.props.on === true) tally.enables++; else tally.disables++;
    }
    return { days, enables: byPlace.settings.enables + byPlace.first_run.enables, disables: byPlace.settings.disables + byPlace.first_run.disables, byPlace };
  });
  const total = optedIn + optedOut;
  return { v: 1, now, optedIn, optedOut, outShare: total ? optedOut / total : null, windows };
}
