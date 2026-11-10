/** Spend wire shapes: the Battery view, a routine's cost forecast and the weekly caps, all in US dollars over the last
 * seven days. A share is of what every bot spent in that window, or of tokens while nothing there has a price. */

export interface BatteryRow {
  kind: "bot" | "routine";
  id: string;
  name: string;
  /** The bot a routine belongs to. */
  botId?: string;
  usd: number;
  tokens: number;
  /** 0 to 1. */
  share: number;
  capUsd?: number;
}

export interface BatteryReport {
  from: string;
  to: string;
  /** "usd" when anything in the window has a price, else "tokens". */
  basis: "usd" | "tokens";
  totalUsd: number;
  totalTokens: number;
  rows: BatteryRow[];
}

export type ForecastWarning = "frequent" | "costly";

export interface RoutineForecast {
  /** Null when its schedule has no fixed rhythm (after a usage limit resets). */
  runsPerWeek: number | null;
  /** The average of its last few runs that have a price; null before any has one. */
  perRunUsd: number | null;
  weekUsd: number | null;
  /** Of what everything spent in the last seven days, 0 to 1; null while that is nothing. */
  shareOfWeek: number | null;
  warnings: ForecastWarning[];
  /** Each recent run's own cost, by run id. */
  runCosts: Record<string, number>;
  capUsd?: number;
  /** What it spent in the last seven days. */
  spentUsd: number;
}

export interface SpendCapInput {
  kind: "bot" | "routine";
  id: string;
  /** Null removes the cap. */
  usd: number | null;
}

/** More often than this a day, a schedule is worth a second look. */
export const FREQUENT_RUNS_PER_DAY = 12;
/** A routine forecast to take more than this share of the week. */
export const COSTLY_SHARE = 0.1;
export const MAX_CAP_USD = 100_000;
