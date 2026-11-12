import { t } from "@/lib/i18n";

/** A usage card that couldn't load: one calm line and try again, laid out as the day-by-day card's (UsageGraph). */
export function LoadFailedRow({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-[13px] leading-[18px]">
      <span role="alert" className="text-ink-secondary">{text}</span>
      <button type="button" onClick={onRetry} className="ui-button">{t("usage.graph.retry")}</button>
    </div>
  );
}
