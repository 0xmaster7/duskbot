// when the sidebar's dusk cloud card shows: a few times on a day the person actually uses the app, more for heavier use,
// hours apart. Each showing stays until it is closed, clicked or the app quits. A showing that was dismissed, or left
// alone until the app quit, makes the card rest: not the next two launches and not for a day. Counters live on this
// computer only.

export const NUDGE_KEY = "dusk-cloud-nudge";
/** the least time between two showings, across midnight too */
export const NUDGE_GAP_MS = 3 * 3600_000;

/** the rest after a dismissed or ignored showing: this many launches, and at least this long */
export const REST_LAUNCHES = 2;
export const REST_MS = 24 * 3600_000;

/** today's use on this computer and today's showings; `lastShownAt` and the rest carry over to the next day.
 * `open`: a showing nobody has answered yet; `skip`: launches the card still sits out; `restUntil`: no showing before then */
export interface NudgeDay { day: string; sessions: number; messages: number; shown: number; lastShownAt: number; open: boolean; skip: number; restUntil: number }

/** the local calendar day, so "today" is the person's own */
export function dayKey(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** the stored record as of `now`: a new day starts its counts at zero; anything unreadable is a fresh start */
export function readNudge(raw: string | null | undefined, now: number): NudgeDay {
  const today = dayKey(now);
  let saved: Partial<NudgeDay> = {};
  try { const parsed: unknown = raw ? JSON.parse(raw) : null; if (parsed && typeof parsed === "object") saved = parsed as Partial<NudgeDay>; } catch {}
  const carried = { lastShownAt: Math.min(count(saved.lastShownAt), now), open: saved.open === true, skip: Math.min(count(saved.skip), REST_LAUNCHES), restUntil: Math.min(count(saved.restUntil), now + REST_MS) };
  if (saved.day !== today) return { day: today, sessions: 0, messages: 0, shown: 0, ...carried };
  return { day: today, sessions: count(saved.sessions), messages: count(saved.messages), shown: count(saved.shown), ...carried };
}

/** how many showings today's use earns: none before a message is sent today (opening the app alone isn't use), one for
 * light use, two for a steady day, three for a heavy one */
export function dailyShowings(day: Pick<NudgeDay, "sessions" | "messages">): 0 | 1 | 2 | 3 {
  if (day.messages < 1) return 0;
  if (day.messages >= 25 || (day.sessions >= 3 && day.messages >= 10)) return 3;
  if (day.messages >= 8 || day.sessions >= 2) return 2;
  return 1;
}

/** when the next showing may start: null when today's are used up (or not earned yet) */
export function nextNudgeAt(day: NudgeDay): number | null {
  if (day.shown >= dailyShowings(day)) return null;
  return Math.max(day.lastShownAt ? day.lastShownAt + NUDGE_GAP_MS : 0, day.restUntil);
}

/** the record after a showing is dismissed, or found unanswered at the next launch: it sits out the next launches and a day */
export const resting = (day: NudgeDay, now: number): NudgeDay => ({ ...day, open: false, skip: REST_LAUNCHES, restUntil: now + REST_MS });

export const nudgeDue = (day: NudgeDay, now: number): boolean => {
  const at = nextNudgeAt(day);
  return at !== null && at <= now;
};

/** whether the card may show at all: the offer is allowed here (not a store build, no dusk cloud yet, nobody's
 * organization), first run is over, and no corner dusk cloud card has this launch */
export function nudgeEligible({ allowed, settled, cornerCard }: { allowed: boolean | null; settled: boolean; cornerCard: boolean }): boolean {
  return allowed === true && settled && !cornerCard;
}

// the running app's side: the record in localStorage, the showing held for this launch, and a listener list
const read = (now: number) => { let raw: string | null = null; try { raw = localStorage.getItem(NUDGE_KEY); } catch {} return readNudge(raw, now); };
const write = (day: NudgeDay) => { try { localStorage.setItem(NUDGE_KEY, JSON.stringify(day)); } catch {} };
const listeners = new Set<() => void>();
let version = 0;
let sessionNoted = false;
let showing = false;
let sitsOut = false;
const changed = () => { version++; for (const listener of listeners) listener(); };

export const watchNudge = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const nudgeVersion = (): number => version;
export const nudgeDay = (now = Date.now()): NudgeDay => read(now);
/** a showing is on screen in this launch */
export const nudgeShowing = (): boolean => showing;

/** this launch, counted once */
export function noteNudgeSession(now = Date.now()): void {
  if (sessionNoted) return;
  sessionNoted = true;
  let day = read(now);
  // a showing nobody answered before the app quit counts as ignored; this launch is the first it sits out
  if (day.open) day = resting(day, now);
  if (day.skip > 0) { sitsOut = true; day = { ...day, skip: day.skip - 1 }; }
  write({ ...day, sessions: day.sessions + 1 });
  changed();
}
/** a message the person sent */
export function noteNudgeMessage(now = Date.now()): void {
  const day = read(now);
  write({ ...day, messages: day.messages + 1, sessions: Math.max(day.sessions, 1) });
  changed();
}
/** starts a showing when one is due; true when it did */
export function takeNudge(now = Date.now()): boolean {
  if (showing || sitsOut) return false;
  const day = read(now);
  if (!nudgeDue(day, now)) return false;
  write({ ...day, shown: day.shown + 1, lastShownAt: now, open: true });
  showing = true;
  changed();
  return true;
}
/** closed (`dismissed`) or clicked: this showing is over; a dismissal makes the card rest */
export function endNudge(dismissed = false, now = Date.now()): void {
  if (!showing) return;
  showing = false;
  const day = read(now);
  write(dismissed ? resting(day, now) : { ...day, open: false });
  changed();
}
