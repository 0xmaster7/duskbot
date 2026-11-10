// One weekly allowance for the whole account, in dollars (allowance.json, 0600): Monday 12:00 AM to the next, on this
// computer's clock. One notice at 80% naming the top two spenders, once a week. At 100% the step in flight finishes and
// what it went over is on us (never counted), new tasks and routine runs wait, the routines that will skip are listed,
// and chat keeps working only in Saver mode, which is always the person's choice. Auto top-up is off by default and
// needs a monthly ceiling. Nothing here applies while no allowance is set.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MAX_CAP_USD, NEAR_SHARE, type AllowanceReport, type AllowanceSpender, type AutoTopUp } from "../shared/spend.ts";
import { writeFileAtomic } from "./atomic.ts";
import { serverLine } from "./server-lines.ts";
import type { Entry } from "./spend.ts";

interface State {
  weeklyUsd?: number;
  week: number;
  extraUsd: number;
  noticedNear?: true;
  hitAt?: number;
  overrunUsd: number;
  saverUsd: number;
  saverUntil?: number;
  dismissed?: "near" | "over";
  autoTopUp: AutoTopUp;
  topUps: Array<{ at: number; usd: number; auto: boolean }>;
}

export interface AllowanceDeps {
  dataDir: string;
  now?: () => number;
  /** What was booked since a time, from server/spend.ts. */
  since(at: number): ReadonlyArray<Readonly<Entry>>;
  names: { bot(id: string): string | undefined; routine(id: string): { name: string; botId: string } | undefined };
  /** Enabled routines with a run before `until`: what skips while the allowance is used up. */
  upcoming(until: number): Array<{ routineId: string; name: string; at: number }>;
  /** One notice in this bot's main chat, with a notification. */
  tell(botId: string, text: string): void;
  language(): string | undefined;
}

const OFF: AutoTopUp = { on: false, stepUsd: 0, monthlyCeilingUsd: 0 };
const cents = (usd: number) => Math.round(usd * 100) / 100;
const amount = (value: unknown, max = MAX_CAP_USD): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max ? cents(value) : null;

/** Monday 12:00 AM of this week, local time. */
export function weekStartOf(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

export function resetOf(weekStart: number): number {
  const date = new Date(weekStart);
  date.setDate(date.getDate() + 7);
  return date.getTime();
}

const monthOf = (at: number) => { const date = new Date(at); return date.getFullYear() * 12 + date.getMonth(); };

export function money(usd: number, language?: string): string {
  try { return new Intl.NumberFormat(language ?? "en-US", { style: "currency", currency: "USD" }).format(usd); }
  catch { return `$${usd.toFixed(2)}`; }
}

/** "Monday 12:00 AM" and "in 2 days", in the person's language. */
export function resetWords(resetAt: number, now: number, language?: string): { reset: string; left: string } {
  const lang = language ?? "en-US";
  let reset: string, left: string;
  try { reset = new Date(resetAt).toLocaleString(lang, { weekday: "long", hour: "numeric", minute: "2-digit" }); }
  catch { reset = new Date(resetAt).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" }); }
  const hours = Math.max(1, Math.round((resetAt - now) / 3_600_000));
  try {
    const format = new Intl.RelativeTimeFormat(lang, { numeric: "always" });
    left = hours >= 48 ? format.format(Math.floor(hours / 24), "day") : format.format(hours, "hour");
  } catch { left = hours >= 48 ? `in ${Math.floor(hours / 24)} days` : `in ${hours} hours`; }
  return { reset, left };
}

/** The week's spenders by what they spent: each routine on its own, each bot's other work on its own. */
export function topSpenders(entries: ReadonlyArray<Readonly<Entry>>, names: AllowanceDeps["names"], count = 2): AllowanceSpender[] {
  const groups = new Map<string, AllowanceSpender>();
  for (const entry of entries) {
    if (!(entry.usd > 0)) continue;
    const key = entry.routineId ? `routine:${entry.routineId}` : `bot:${entry.botId}`;
    let group = groups.get(key);
    if (!group) {
      const routine = entry.routineId ? names.routine(entry.routineId) : undefined;
      group = entry.routineId
        ? { kind: "routine", id: entry.routineId, name: routine?.name ?? entry.routineName ?? entry.routineId, usd: 0, botId: routine?.botId ?? entry.botId }
        : { kind: "bot", id: entry.botId, name: names.bot(entry.botId) ?? entry.botName, usd: 0 };
      groups.set(key, group);
    }
    group.usd += entry.usd;
  }
  return [...groups.values()].sort((a, b) => b.usd - a.usd).slice(0, count).map((group) => ({ ...group, usd: cents(group.usd) }));
}

export function createAllowance(deps: AllowanceDeps) {
  const now = deps.now ?? Date.now;
  const file = join(deps.dataDir, "allowance.json");
  let state = load();

  function load(): State {
    const fresh: State = { week: weekStartOf(now()), extraUsd: 0, overrunUsd: 0, saverUsd: 0, autoTopUp: { ...OFF }, topUps: [] };
    try {
      const value = JSON.parse(readFileSync(file, "utf8")) as Partial<State>;
      const auto = value.autoTopUp;
      const step = amount(auto?.stepUsd), ceiling = amount(auto?.monthlyCeilingUsd);
      return {
        ...fresh,
        ...(amount(value.weeklyUsd) ? { weeklyUsd: amount(value.weeklyUsd)! } : {}),
        week: Number.isSafeInteger(value.week) ? value.week! : fresh.week,
        extraUsd: amount(value.extraUsd) ?? 0,
        ...(value.noticedNear === true ? { noticedNear: true as const } : {}),
        ...(Number.isSafeInteger(value.hitAt) ? { hitAt: value.hitAt } : {}),
        overrunUsd: typeof value.overrunUsd === "number" && value.overrunUsd >= 0 ? value.overrunUsd : 0,
        saverUsd: typeof value.saverUsd === "number" && value.saverUsd >= 0 ? value.saverUsd : 0,
        ...(Number.isSafeInteger(value.saverUntil) ? { saverUntil: value.saverUntil } : {}),
        ...(value.dismissed === "near" || value.dismissed === "over" ? { dismissed: value.dismissed } : {}),
        autoTopUp: auto?.on === true && step && ceiling ? { on: true, stepUsd: step, monthlyCeilingUsd: ceiling } : { ...OFF, ...(step ? { stepUsd: step } : {}), ...(ceiling ? { monthlyCeilingUsd: ceiling } : {}) },
        topUps: Array.isArray(value.topUps) ? value.topUps.filter((one) => one && Number.isSafeInteger(one.at) && amount(one.usd)).slice(-100) : [],
      };
    } catch {
      return fresh;
    }
  }

  function save(): void {
    try { writeFileAtomic(file, JSON.stringify(state), { mode: 0o600 }); }
    catch (error) { console.error(`allowance: could not save: ${error instanceof Error ? error.message : String(error)}`); }
  }

  /** A new week starts clean: its own top-ups, notices, overrun and Saver mode. */
  function roll(): void {
    const week = weekStartOf(now());
    if (state.week === week) return;
    const month = monthOf(now());
    state = { ...state, week, extraUsd: 0, overrunUsd: 0, saverUsd: 0, topUps: state.topUps.filter((one) => monthOf(one.at) === month) };
    for (const key of ["noticedNear", "hitAt", "saverUntil", "dismissed"] as const) delete state[key];
    save();
  }

  const limit = () => (state.weeklyUsd === undefined ? null : cents(state.weeklyUsd + state.extraUsd));
  const spentTotal = () => state.weeklyUsd === undefined ? 0 : deps.since(state.week).reduce((sum, entry) => sum + entry.usd, 0);
  const saverOn = () => state.saverUntil !== undefined && now() < state.saverUntil;
  const monthUsd = () => { const month = monthOf(now()); return cents(state.topUps.filter((one) => monthOf(one.at) === month).reduce((sum, one) => sum + one.usd, 0)); };

  function levelOf(spent: number, cap: number | null): AllowanceReport["level"] {
    if (cap === null) return "off";
    if (spent >= cap) return "over";
    return spent >= cap * NEAR_SHARE ? "near" : "ok";
  }

  function topLine(language: string | undefined): string {
    const top = topSpenders(deps.since(state.week), deps.names);
    const named = top.map((one) => serverLine(language, "server.allowance.spender", { name: one.name, amount: money(one.usd, language) }));
    return named.length === 2 ? serverLine(language, "server.allowance.topTwo", { first: named[0]!, second: named[1]! }) : named[0] ?? "";
  }

  function overLine(language: string | undefined, botId: string): void {
    const at = now(), words = resetWords(resetOf(state.week), at, language);
    const skipped = deps.upcoming(resetOf(state.week));
    const names = skipped.slice(0, 5).map((one) => one.name).join(", ") + (skipped.length > 5 ? ` +${skipped.length - 5}` : "");
    deps.tell(botId, [
      serverLine(language, "server.allowance.over", { limit: money(limit()!, language), over: money(cents(state.overrunUsd), language) }),
      skipped.length ? serverLine(language, "server.allowance.skips", { count: skipped.length, names }) : "",
      serverLine(language, "server.allowance.overTail", words),
    ].filter(Boolean).join(" "));
  }

  return {
    /** After every booked turn, from server/spend.ts's ledger. */
    booked(entry: Readonly<Entry>): void {
      roll();
      const cap = limit();
      if (cap === null || !(entry.usd > 0)) return;
      const spent = spentTotal();
      const language = deps.language();
      if (state.hitAt !== undefined) {
        // past the limit: Saver chats are the person's choice; anything else is a step that was already running
        if (saverOn()) state.saverUsd += entry.usd;
        else state.overrunUsd += entry.usd;
        return save();
      }
      if (spent >= cap) {
        const auto = state.autoTopUp;
        if (auto.on && monthUsd() + auto.stepUsd <= auto.monthlyCeilingUsd) {
          state.extraUsd = cents(state.extraUsd + auto.stepUsd);
          state.topUps.push({ at: now(), usd: auto.stepUsd, auto: true });
          save();
          deps.tell(entry.botId, serverLine(language, "server.allowance.autoTopUp", { amount: money(auto.stepUsd, language), month: money(monthUsd(), language), ceiling: money(auto.monthlyCeilingUsd, language) }));
          if (spent < limit()!) return;
        }
        state.hitAt = now();
        state.overrunUsd = Math.max(0, spent - limit()!);
        delete state.dismissed;
        save();
        return overLine(language, entry.botId);
      }
      if (spent >= cap * NEAR_SHARE && !state.noticedNear) {
        state.noticedNear = true;
        save();
        const words = resetWords(resetOf(state.week), now(), language);
        deps.tell(entry.botId, serverLine(language, "server.allowance.near", { spent: money(cents(spent), language), limit: money(cap, language), top: topLine(language), reset: words.reset }));
      }
    },

    /** New work may not start: the allowance is set and used up. */
    over(): boolean {
      roll();
      const cap = limit();
      return cap !== null && spentTotal() >= cap;
    },
    saverOn(): boolean { roll(); return saverOn(); },

    /** Why a routine run waits, or null. */
    held(language?: string): string | null {
      if (!this.over()) return null;
      return serverLine(language, "server.allowance.held", resetWords(resetOf(state.week), now(), language));
    },
    /** Why a person's new task waits, or null; nothing while Saver mode is on. */
    refusal(language?: string): string | null {
      if (!this.over() || saverOn()) return null;
      return serverLine(language, "server.allowance.refused", { limit: money(limit()!, language), ...resetWords(resetOf(state.week), now(), language) });
    },

    report(): AllowanceReport {
      roll();
      const cap = limit(), spent = spentTotal(), level = levelOf(spent, cap), resetAt = resetOf(state.week);
      return {
        weeklyUsd: state.weeklyUsd ?? null,
        extraUsd: state.extraUsd,
        limitUsd: cap,
        spentUsd: cap === null ? cents(spent) : cents(Math.min(spent, cap)),
        overrunUsd: cents(state.overrunUsd),
        share: cap ? Math.min(1, spent / cap) : 0,
        level,
        weekStart: state.week,
        resetAt,
        top: cap === null ? [] : topSpenders(deps.since(state.week), deps.names),
        skipped: level === "over" ? deps.upcoming(resetAt) : [],
        saver: saverOn(),
        saverUsd: cents(state.saverUsd),
        dismissed: state.dismissed !== undefined && state.dismissed === level,
        autoTopUp: { ...state.autoTopUp, monthUsd: monthUsd() },
      };
    },

    /** Null removes it. Setting one under this week's spend makes it used up at once, with no notice: the person just did it. */
    setWeekly(usd: number | null): void {
      roll();
      if (usd === null) delete state.weeklyUsd;
      else state.weeklyUsd = cents(usd);
      const cap = limit(), spent = spentTotal();
      if (cap === null || spent < cap) { delete state.hitAt; state.overrunUsd = 0; }
      else state.hitAt ??= now();
      if (cap === null || spent < cap * NEAR_SHARE) delete state.noticedNear;
      delete state.dismissed;
      save();
    },

    /** Adds to this week only, at the price the person saw. */
    addForWeek(usd: number): void {
      roll();
      state.extraUsd = cents(state.extraUsd + usd);
      state.topUps.push({ at: now(), usd: cents(usd), auto: false });
      const cap = limit();
      if (cap !== null && spentTotal() < cap) { delete state.hitAt; delete state.dismissed; }
      save();
    },

    setSaver(on: boolean): void {
      roll();
      if (on) state.saverUntil = resetOf(state.week);
      else delete state.saverUntil;
      save();
    },

    setAutoTopUp(input: AutoTopUp): void {
      state.autoTopUp = input.on ? { on: true, stepUsd: cents(input.stepUsd), monthlyCeilingUsd: cents(input.monthlyCeilingUsd) } : { ...state.autoTopUp, on: false };
      save();
    },

    /** "Leave it" or "Wait for Monday": this level's notice stays out of the way for the week. */
    dismiss(): void {
      const level = this.report().level;
      if (level === "near" || level === "over") { state.dismissed = level; save(); }
    },
  };
}

export type Allowance = ReturnType<typeof createAllowance>;

/** A request body's allowance change, or null when it is not one. */
export function validWeekly(body: unknown): { usd: number | null } | null {
  const usd = (body as { usd?: unknown } | null)?.usd;
  if (usd === null) return { usd: null };
  const value = amount(usd);
  return value === null ? null : { usd: value };
}

export function validTopUp(body: unknown): number | null {
  return amount((body as { usd?: unknown } | null)?.usd, 10_000);
}

export function validAutoTopUp(body: unknown): AutoTopUp | null {
  const value = body as Partial<AutoTopUp> | null;
  if (!value || typeof value.on !== "boolean") return null;
  if (!value.on) return { on: false, stepUsd: 0, monthlyCeilingUsd: 0 };
  const step = amount(value.stepUsd, 10_000), ceiling = amount(value.monthlyCeilingUsd);
  return step && ceiling && step <= ceiling ? { on: true, stepUsd: step, monthlyCeilingUsd: ceiling } : null;
}
