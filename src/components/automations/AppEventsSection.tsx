import { attemptLine, skippedToday } from "@/lib/app-automations";
import { useAppTriggers, type AppTrigger } from "@/lib/app-triggers";
import { lastWhen } from "@/lib/automations";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

const RECENT = 6;

/** What arrived lately, what was skipped today and why, and the day's limit for this computer or Cloud. */
export function AppEventsSection({ trigger }: { trigger: AppTrigger }) {
  const { attempts, service } = useAppTriggers();
  const recent = attempts.filter((attempt) => attempt.triggerId === trigger.id).slice(-RECENT).reverse();
  const skipped = skippedToday(trigger);
  return (
    <section data-app-events={trigger.id}>
      <h3 className="m-0 mb-1 text-[12px] font-normal leading-4 tracking-[0.01em] text-ink/56">{t("automations.panel.events")}</h3>
      {skipped && <p className="m-0 mb-1 text-[12px] leading-4 text-warning">{skipped}</p>}
      {recent.length === 0
        ? <p className="m-0 text-[13px] leading-[18px] text-ink/68">{t("automations.panel.noEvents")}</p>
        : <ul className="space-y-1">{recent.map((attempt) => {
          const line = attemptLine(attempt);
          const when = lastWhen(attempt.at);
          return (
            <li key={attempt.id} className="flex items-baseline gap-2 py-1 text-[13px] leading-[18px]">
              <span className="shrink-0 text-ink/68">{when.charAt(0).toLocaleUpperCase() + when.slice(1)}</span>
              <span className={cn("shrink-0 font-semibold", line.mark === "✓" ? "text-success" : line.mark === "✗" ? "text-danger" : "text-ink-tertiary")}>{line.mark}</span>
              <span className="min-w-0 truncate text-ink" title={line.text}>{line.text}</span>
            </li>
          );
        })}</ul>}
      {service?.eventsPerDay && (
        <p className="m-0 mt-1 text-[12px] leading-4 text-ink/56">
          {t("automations.app.limit", { count: service.eventsPerDay.toLocaleString(), place: t(service.plan === "cloud" ? "automations.app.placeCloud" : "automations.app.placeDesktop") })}
        </p>
      )}
    </section>
  );
}
