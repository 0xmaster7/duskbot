import type { Bot, Category, Coverage, Metric, Routine, Turn } from "../data/types";
import { categoryLabel } from "../data/fixtures";
import { dayKey } from "./format";

const DAY = 86_400_000;

export interface Split { paid: number; included: number; trial: number; own: number }
export const emptySplit = (): Split => ({ paid: 0, included: 0, trial: 0, own: 0 });

export function splitOf(turn: Turn, into = emptySplit()): Split {
  for (const line of turn.lines) into[line.coverage] += line.usd;
  return into;
}
export const billedValue = (s: Split) => s.paid + s.included + s.trial;

export const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const addDays = (t: number, n: number) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };

export interface TurnFilter { from: number; to: number; botId?: string; category?: Category; coverage?: Coverage; status?: Turn["status"]; source?: Turn["source"] }

export function filterTurns(turns: Turn[], f: TurnFilter): Turn[] {
  return turns.filter((t) => t.at >= f.from && t.at < f.to
    && (!f.botId || t.botId === f.botId)
    && (!f.status || t.status === f.status)
    && (!f.source || t.source === f.source)
    && (!f.category || t.lines.some((l) => l.category === f.category))
    && (!f.coverage || t.lines.some((l) => l.coverage === f.coverage)));
}

export const turnTotal = (t: Turn) => t.lines.reduce((s, l) => s + (l.coverage === "own" ? 0 : l.usd), 0);
export const turnPaid = (t: Turn) => t.lines.reduce((s, l) => s + (l.coverage === "paid" ? l.usd : 0), 0);

export interface DayPoint { key: string; t: number; byCategory: Record<Category, number>; paid: number; total: number; turns: number }

export function daily(turns: Turn[], from: number, to: number): DayPoint[] {
  const days: DayPoint[] = [];
  const index = new Map<string, DayPoint>();
  for (let t = startOfDay(from); t < to; t = addDays(t, 1)) {
    const point: DayPoint = { key: dayKey(t), t, byCategory: { ai: 0, computer: 0, voice: 0, research: 0, machine: 0 }, paid: 0, total: 0, turns: 0 };
    days.push(point);
    index.set(point.key, point);
  }
  for (const turn of turns) {
    const point = index.get(dayKey(turn.at));
    if (!point) continue;
    if (turn.status === "ok") point.turns++;
    for (const line of turn.lines) {
      if (line.coverage === "own") continue;
      point.byCategory[line.category] += line.usd;
      point.total += line.usd;
      if (line.coverage === "paid") point.paid += line.usd;
    }
  }
  return days;
}

export interface HeatCell { key: string; t: number; value: number; level: 0 | 1 | 2 | 3 | 4; future: boolean; byBot: Array<{ botId: string; turns: number }>; paid: number; hours: number; turns: number }

/** A year of days ending today, padded to whole weeks; levels are quartiles of the non-zero days, as GitHub does. */
export function heatmap(turns: Turn[], now: number, metric: Metric, weekStart: 0 | 1, botId?: string): { weeks: HeatCell[][]; total: number; active: number; busiest: HeatCell | null; streak: number; longest: number } {
  const today = startOfDay(now);
  let first = addDays(today, -364);
  while (new Date(first).getDay() !== weekStart) first = addDays(first, -1);
  const cells = new Map<string, HeatCell>();
  const ordered: HeatCell[] = [];
  for (let t = first; ordered.length % 7 !== 0 || t <= today; t = addDays(t, 1)) {
    const cell: HeatCell = { key: dayKey(t), t, value: 0, level: 0, future: t > today, byBot: [], paid: 0, hours: 0, turns: 0 };
    cells.set(cell.key, cell);
    ordered.push(cell);
  }
  const bots = new Map<string, Map<string, number>>();
  for (const turn of turns) {
    if (botId && turn.botId !== botId) continue;
    const cell = cells.get(dayKey(turn.at));
    if (!cell || turn.status !== "ok") continue;
    cell.turns++;
    cell.paid += turnPaid(turn);
    cell.hours += turn.computerMinutes / 60;
    const perBot = bots.get(cell.key) ?? new Map<string, number>();
    perBot.set(turn.botId, (perBot.get(turn.botId) ?? 0) + 1);
    bots.set(cell.key, perBot);
  }
  for (const cell of ordered) {
    cell.value = metric === "turns" ? cell.turns : metric === "spend" ? cell.paid : cell.hours;
    cell.byBot = [...(bots.get(cell.key) ?? new Map()).entries()].map(([id, n]) => ({ botId: id, turns: n })).sort((a, b) => b.turns - a.turns);
  }
  const nonzero = ordered.filter((c) => c.value > 0).map((c) => c.value).sort((a, b) => a - b);
  const q = (p: number) => nonzero[Math.min(nonzero.length - 1, Math.floor(p * nonzero.length))] ?? 0;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  for (const cell of ordered) cell.level = cell.value <= 0 ? 0 : cell.value <= q1 ? 1 : cell.value <= q2 ? 2 : cell.value <= q3 ? 3 : 4;
  const weeks: HeatCell[][] = [];
  for (let i = 0; i < ordered.length; i += 7) weeks.push(ordered.slice(i, i + 7));
  const past = ordered.filter((c) => !c.future);
  let streak = 0;
  for (let i = past.length - 1; i >= 0 && past[i]!.value > 0; i--) streak++;
  let longest = 0, run = 0;
  for (const c of past) { run = c.value > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  const busiest = past.reduce<HeatCell | null>((best, c) => (c.value > (best?.value ?? 0) ? c : best), null);
  return { weeks, total: past.reduce((s, c) => s + c.value, 0), active: nonzero.length, busiest, streak, longest };
}

export interface Forecast { low: number; high: number; mid: number; spent: number; driver: string | null; perDay: number }

export function forecast(turns: Turn[], bots: Bot[], now: number, periodStart: number, periodEnd: number, pick: (t: Turn) => number = turnPaid): Forecast {
  const inPeriod = turns.filter((t) => t.at >= periodStart && t.at <= now);
  const spent = inPeriod.reduce((s, t) => s + pick(t), 0);
  const weekAgo = now - 7 * DAY;
  const lastWeek = turns.filter((t) => t.at >= weekAgo && t.at <= now);
  const weekRate = lastWeek.reduce((s, t) => s + pick(t), 0) / 7;
  const elapsed = Math.max(1, (now - periodStart) / DAY);
  const rate = 0.65 * weekRate + 0.35 * (spent / elapsed);
  const left = Math.max(0, (periodEnd - now) / DAY);
  const mid = spent + rate * left;
  const byBot = new Map<string, number>();
  for (const t of lastWeek) byBot.set(t.botId, (byBot.get(t.botId) ?? 0) + pick(t));
  const top = [...byBot.entries()].sort((a, b) => b[1] - a[1])[0];
  let driver: string | null = null;
  if (top && top[1] > 0) {
    const bot = bots.find((b) => b.id === top[0]);
    const routine = bot?.routines.filter((r) => r.state === "on").sort((a, b) => b.costPerRunUsd - a.costPerRunUsd)[0];
    driver = bot ? (routine ? `${bot.name}'s ${routine.name.toLowerCase()} routine` : bot.name) : null;
  }
  return { spent, mid, low: spent + rate * left * 0.85, high: spent + rate * left * 1.15, driver, perDay: rate };
}

export type GroupBy = "bot" | "model" | "category" | "source" | "day";

export interface GroupRow { key: string; label: string; turns: number; tokens: number; computerMinutes: number; split: Split; share: number }

export function groupTurns(turns: Turn[], by: GroupBy, bots: Bot[]): GroupRow[] {
  const rows = new Map<string, GroupRow>();
  const name = (id: string) => bots.find((b) => b.id === id)?.name ?? id;
  const add = (key: string, label: string, turn: Turn, lines = turn.lines) => {
    const row = rows.get(key) ?? { key, label, turns: 0, tokens: 0, computerMinutes: 0, split: emptySplit(), share: 0 };
    row.turns++;
    row.tokens += turn.input + turn.output;
    row.computerMinutes += turn.computerMinutes;
    for (const l of lines) row.split[l.coverage] += l.usd;
    rows.set(key, row);
  };
  for (const turn of turns) {
    if (by === "category") for (const line of turn.lines) add(line.category, categoryLabel[line.category], turn, [line]);
    else if (by === "bot") add(turn.botId, name(turn.botId), turn);
    else if (by === "model") add(turn.model, turn.model, turn);
    else if (by === "source") add(turn.source, sourceLabel[turn.source], turn);
    else add(dayKey(turn.at), dayKey(turn.at), turn);
  }
  const list = [...rows.values()];
  const total = list.reduce((s, r) => s + billedValue(r.split) + r.split.own, 0) || 1;
  for (const row of list) row.share = (billedValue(row.split) + row.split.own) / total;
  return by === "day" ? list.sort((a, b) => b.key.localeCompare(a.key)) : list.sort((a, b) => billedValue(b.split) + b.split.own - (billedValue(a.split) + a.split.own));
}

export const sourceLabel: Record<Turn["source"], string> = { chat: "Chat", routine: "Routine", room: "Room", webhook: "Webhook" };

export function routineRunsLeft(routine: Routine, now: number, periodEnd: number): number {
  if (routine.state !== "on" || !routine.nextRunAt) return 0;
  const days = Math.max(0, (periodEnd - now) / DAY);
  if (routine.schedule.startsWith("Every 2 hours")) return Math.round(days * 7);
  if (routine.schedule.startsWith("Weekdays")) return Math.round(days * 5 / 7);
  if (routine.schedule.startsWith("Every day")) return Math.round(days);
  return Math.round(days / 7);
}

export function toCsv(turns: Turn[], bots: Bot[]): string {
  const name = (id: string) => bots.find((b) => b.id === id)?.name ?? id;
  const head = ["time", "bot", "source", "model", "input_tokens", "output_tokens", "cached_tokens", "tool_calls", "computer_minutes", "paid_usd", "included_usd", "trial_usd", "own_estimate_usd", "status", "thread"];
  const rows = turns.map((t) => {
    const s = splitOf(t);
    return [new Date(t.at).toISOString(), name(t.botId), t.source, t.model, t.input, t.output, t.cached, t.tools, t.computerMinutes, s.paid.toFixed(4), s.included.toFixed(4), s.trial.toFixed(4), s.own.toFixed(4), t.status, t.threadId].join(",");
  });
  return [head.join(","), ...rows].join("\n");
}

export function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
