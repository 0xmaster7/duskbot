import { useEffect, useRef, useState } from "react";
import { activeLocale, t } from "@/lib/i18n";
import { formatCost } from "@/lib/usage-trace";
import { api } from "@/state/store";
import type { BatteryReport, RoutineForecast, SpendCapInput } from "../../shared/spend";
import type { RoutinePause } from "../../shared/routines";

export type { BatteryReport, BatteryRow, RoutineForecast } from "../../shared/spend";

export const fetchBattery = (): Promise<BatteryReport> => api("/api/usage/battery");
export const fetchForecast = (routineId: string): Promise<RoutineForecast> => api(`/api/routines/${encodeURIComponent(routineId)}/forecast`);
export const saveCap = (input: SpendCapInput): Promise<unknown> => api("/api/usage/caps", { method: "PUT", body: JSON.stringify(input) });

export function sharePercent(share: number): string {
  return new Intl.NumberFormat(activeLocale(), { style: "percent", maximumFractionDigits: share > 0 && share < 0.01 ? 1 : 0 }).format(share);
}

/** Loads again whenever `version` changes; null until the first answer, and on a failure. */
export function useLoaded<T>(load: () => Promise<T>, version: unknown): T | null {
  const [value, setValue] = useState<T | null>(null);
  const loader = useRef(load);
  useEffect(() => { loader.current = load; });
  useEffect(() => {
    let current = true;
    void loader.current().then((next) => { if (current) setValue(next); }).catch(() => { if (current) setValue(null); });
    return () => { current = false; };
  }, [version]);
  return value;
}

/** "About 168 runs a week · about $3.20 a week · 12% of your week", saying only what is known. */
export function forecastLine(forecast: RoutineForecast): string {
  const parts: string[] = [];
  if (forecast.runsPerWeek !== null) parts.push(t("routines.cost.runs", { count: String(forecast.runsPerWeek) }));
  if (forecast.weekUsd !== null) parts.push(t("routines.cost.week", { amount: formatCost(forecast.weekUsd) }));
  else parts.push(t("routines.cost.noPrice"));
  if (forecast.shareOfWeek !== null) parts.push(t("routines.cost.share", { percent: sharePercent(forecast.shareOfWeek) }));
  return parts.join(" · ");
}

export function pauseLine(pause: RoutinePause): string {
  return pause.by === "cap"
    ? t("routines.paused.cap", { amount: formatCost(pause.capUsd) })
    : t("routines.paused.failures", { error: pause.error });
}
