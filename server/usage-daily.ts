import type { DailyUsageReport, DailyUsageSeries } from "../shared/spend.ts";
import type { UsageRow } from "./usage-ledger.ts";

const DAY_MS = 24 * 60 * 60_000;
export const MAX_DAILY_DAYS = 90;
export const DAILY_SERIES = 5;

const positive = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

/** The viewer's day for an instant: `offsetMinutes` is what `Date.getTimezoneOffset()` gives (minutes west of UTC). */
export function dayKey(at: number, offsetMinutes: number): string {
  return new Date(at - offsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function dailyStart(now: number, days: number, offsetMinutes: number): number {
  return Date.parse(`${dayKey(now, offsetMinutes)}T00:00:00Z`) - (days - 1) * DAY_MS + offsetMinutes * 60_000;
}

export function clampDays(value: unknown): number {
  const days = Math.round(Number(value));
  return Number.isFinite(days) && days >= 1 ? Math.min(MAX_DAILY_DAYS, days) : 14;
}

export function clampOffset(value: unknown): number {
  const offset = Math.round(Number(value));
  return Number.isFinite(offset) && Math.abs(offset) <= 14 * 60 ? offset : 0;
}

export function dailyUsage(rows: readonly UsageRow[], options: {
  now: number;
  days: number;
  offsetMinutes: number;
  botName?: (id: string) => string | undefined;
  top?: number;
}): DailyUsageReport {
  const { now, offsetMinutes } = options;
  const count = clampDays(options.days);
  const top = options.top ?? DAILY_SERIES;
  const start = dailyStart(now, count, offsetMinutes);
  const days = Array.from({ length: count }, (_, index) => dayKey(start + index * DAY_MS + 12 * 60 * 60_000, offsetMinutes));
  const slot = new Map(days.map((day, index) => [day, index]));
  const inRange = rows.flatMap((row) => {
    const at = Date.parse(row.at);
    const index = Number.isFinite(at) && at <= now ? slot.get(dayKey(at, offsetMinutes)) : undefined;
    return index === undefined ? [] : [{ row, index }];
  });
  const basis = inRange.some(({ row }) => positive(row.costUsd) > 0) ? "usd" : "tokens";
  const amount = (row: UsageRow) => (basis === "usd" ? positive(row.costUsd) : positive(row.input) + positive(row.output));

  const bots = new Map<string, { name: string; values: number[]; total: number }>();
  for (const { row, index } of inRange) {
    const value = amount(row);
    if (value <= 0) continue;
    let bot = bots.get(row.botId);
    if (!bot) bots.set(row.botId, bot = { name: options.botName?.(row.botId) ?? (row.botName || row.botId), values: days.map(() => 0), total: 0 });
    bot.values[index]! += value;
    bot.total += value;
  }
  const ranked = [...bots.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
  const shown = ranked.length === top + 1 ? top + 1 : top;
  const series: DailyUsageSeries[] = ranked.slice(0, shown).map(([botId, bot]) => ({ key: `bot:${botId}`, botId, name: bot.name, values: bot.values, total: bot.total }));
  const rest = ranked.slice(shown);
  if (rest.length) {
    const values = days.map((_, index) => rest.reduce((sum, [, bot]) => sum + bot.values[index]!, 0));
    series.push({ key: "other", botId: null, name: "", values, total: values.reduce((sum, value) => sum + value, 0), bots: rest.length });
  }
  const totals = days.map((_, index) => series.reduce((sum, one) => sum + one.values[index]!, 0));
  return { days, basis, total: totals.reduce((sum, value) => sum + value, 0), totals, series };
}
