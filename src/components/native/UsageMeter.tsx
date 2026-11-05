import { useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { reportsUsage, usageRows, useEngineLimits, windowLabel, type EngineLimit } from "@/lib/limit-resets";
import { NEAR_LIMIT_PERCENT } from "../../../shared/limit-reset";
import { GrokIcon } from "../GrokIcon";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function relative(at: number, now: number): string {
  const left = Math.max(0, at - now);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const when = left >= DAY ? format.format(Math.round(left / DAY), "day")
    : left >= HOUR ? format.format(Math.round(left / HOUR), "hour")
      : format.format(Math.max(1, Math.round(left / MINUTE)), "minute");
  return when;
}

/** "Resets in 4 days", or with its window "Weekly limit resets in 4 days": Grok's relative reset line. */
export function resetsIn(at: number, now = Date.now(), window?: Parameters<typeof windowLabel>[0]): string {
  const when = relative(at, now);
  return window ? t("nativeUsage.windowResets", { window: windowLabel(window), when }) : t("nativeUsage.resets", { when });
}

/** The window's reset line, or just its name when the reset time is unknown. */
function windowLine(window: Parameters<typeof windowLabel>[0], resetsAt: number | null, now: number): string {
  return resetsAt !== null && resetsAt > now ? resetsIn(resetsAt, now, window) : windowName(window);
}

const usedOf = (left: number) => 100 - left;

/** Grok's 4px meter: a 6% ink track and the switch blue fill, amber near the limit. */
export function UsageBar({ used, warn, className }: { used: number; warn?: boolean; className?: string }) {
  return (
    <div aria-hidden="true" data-usage-meter="" className={cn("h-1 overflow-hidden rounded-full bg-ink/[0.06]", className)}>
      <div className={cn("h-full rounded-full", warn ? "bg-warning" : "bg-accent-border")} style={{ width: `${Math.min(100, Math.max(0, used))}%` }} />
    </div>
  );
}

function windowName(window: Parameters<typeof windowLabel>[0]) {
  return t("nativeUsage.windowLimit", { window: windowLabel(window) });
}

/** One engine as Grok's weekly usage card: the deciding window large, any other window as a compact meter under it. */
export function UsageMeterCard({ limit, now = Date.now() }: { limit: EngineLimit; now?: number }) {
  const rows = usageRows(limit);
  const lead = rows.find((row) => row.window === limit.window) ?? rows[0];
  if (!lead) return null;
  const rest = rows.filter((row) => row !== lead);
  return (
    <div data-usage-card={limit.engine} role="group" aria-label={t("nativeUsage.title", { engine: limit.name })}
      className="flex flex-col rounded-[14px] bg-menu px-3.5 pb-3.5 pt-4 outline-[0.5px] outline-offset-[-0.5px] outline-edge [outline-style:solid]">
      <div className="text-[13px] leading-[18px] tracking-[-0.08px] text-ink">{t("nativeUsage.title", { engine: limit.name })}</div>
      <div className="mt-2.5 flex items-baseline gap-1">
        {lead.tone === "out" ? (
          <span className="text-[22px] leading-7 tracking-[0.22px] text-ink">{t("nativeUsage.atLimit")}</span>
        ) : (
          <>
            <span className="text-[22px] leading-7 tracking-[0.22px] text-ink tabular-nums">{usedOf(lead.left)}%</span>
            <span className="text-[13px] leading-[18px] text-ink/[0.56]">{t("nativeUsage.used")}</span>
          </>
        )}
      </div>
      <UsageBar used={usedOf(lead.left)} warn={lead.tone !== "fine"} className="mt-2.5" />
      <div className="mt-1.5 text-[11px] leading-[14px] tracking-[0.07px] text-ink-secondary">
        {windowLine(lead.window, lead.resetsAt, now)}
      </div>
      {rest.map((row) => (
        <div key={row.window} data-usage-window={row.window} className="mt-4 flex flex-col">
          <UsageBar used={usedOf(row.left)} warn={row.tone !== "fine"} />
          <div className="mt-1.5 flex items-baseline justify-between gap-3 text-[11px] leading-[14px] tracking-[0.07px] text-ink-secondary">
            <span className="min-w-0 truncate">{windowLine(row.window, row.resetsAt, now)}</span>
            <span className="shrink-0 tabular-nums">{row.tone === "out" ? t("nativeUsage.atLimit") : `${usedOf(row.left)}% ${t("nativeUsage.used")}`}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The panel row under the model: "Usage", its window and reset, the share used on the right, then the meter. */
export function UsageMeterRow({ engine }: { engine: string | undefined }) {
  const limit = useEngineLimits().find((candidate) => candidate.engine === engine);
  if (!reportsUsage(limit)) return null;
  const rows = usageRows(limit);
  const lead = rows.find((row) => row.window === limit.window) ?? rows[0];
  if (!lead) return null;
  const hint = windowLine(lead.window, lead.resetsAt, Date.now());
  return (
    <div data-panel-row="usage" className="flex flex-col gap-1.5 rounded-lg px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] leading-[18px] tracking-[0.015em] text-ink">{t("nativeUsage.rowTitle")}</div>
          <div className="truncate text-[13px] leading-[18px] tracking-[0.015em] text-ink-secondary">{hint}</div>
        </div>
        <span className={cn("shrink-0 text-[13px] leading-[18px] tabular-nums", lead.tone === "fine" ? "text-ink-secondary" : "text-warning")}>
          {lead.tone === "out" ? t("nativeUsage.atLimit") : `${usedOf(lead.left)}% ${t("nativeUsage.used")}`}
        </span>
      </div>
      <UsageBar used={usedOf(lead.left)} warn={lead.tone !== "fine"} />
    </div>
  );
}

const dismissed = new Set<string>();
const dismissKey = (limit: EngineLimit) => `${limit.engine}:${limit.resetsAt ?? ""}`;

/** Grok's composer-dock usage warning, shown near or at the engine's limit until dismissed for that reset. */
export function UsageBanner({ engine, onSeeUsage }: { engine: string | undefined; onSeeUsage: () => void }) {
  const limit = useEngineLimits().find((candidate) => candidate.engine === engine);
  const [, setHidden] = useState(0);
  if (!reportsUsage(limit) || dismissed.has(dismissKey(limit))) return null;
  const used = Math.round(limit.usedPercent ?? 0);
  if (!limit.blocked && used < NEAR_LIMIT_PERCENT) return null;
  const now = Date.now();
  const out = limit.blocked || used >= 100;
  const reset = limit.resetsAt !== null && limit.resetsAt > now ? resetsIn(limit.resetsAt, now) : null;
  return (
    <div role="status" data-usage-banner={out ? "danger" : "warning"}
      className="flex items-start gap-2.5 rounded-[14px] bg-menu py-2.5 pe-2 ps-3.5 outline-[0.5px] outline-offset-[-0.5px] outline-edge [outline-style:solid]">
      <GrokIcon name="chart-bars" size={14} className={cn("mt-0.5 shrink-0", out ? "text-danger" : "text-warning")} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-[18px] tracking-[-0.08px] text-ink">
          {out ? t("nativeUsage.banner.out", { engine: limit.name }) : t("nativeUsage.banner.near", { engine: limit.name, percent: used })}
        </div>
        {reset && <div className="text-[13px] leading-[18px] tracking-[-0.08px] text-ink-secondary">{reset}</div>}
      </div>
      <button type="button" data-usage-see="" onClick={onSeeUsage}
        className="h-6 shrink-0 cursor-pointer rounded-full px-2 text-[12px] leading-4 text-ink transition-colors duration-[120ms] ease-out hover:bg-ink/[0.06] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
        {t("nativeUsage.banner.see")}
      </button>
      <button type="button" aria-label={t("nativeUsage.banner.dismiss")} title={t("nativeUsage.banner.dismiss")}
        onClick={() => { dismissed.add(dismissKey(limit)); setHidden((count) => count + 1); }}
        className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink/[0.56] transition-colors duration-[120ms] ease-out hover:bg-ink/[0.06] hover:text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
        <GrokIcon name="close" size={12} />
      </button>
    </div>
  );
}
