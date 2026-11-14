import { capabilityBadges, contextLabel, priceLabel, type SearchModel } from "../../../shared/model-search";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";

const CHIP = "shrink-0 rounded-[5px] bg-ink/[0.06] px-1.5 text-[11px] leading-4 text-ink-secondary";

/** What a model can do and what it costs, as small tonal chips: context, price per million tokens, tools, vision, reasoning. */
export function ModelBadges({ model, className }: { model: SearchModel; className?: string }) {
  const context = contextLabel(model.context);
  const price = priceLabel(model);
  const badges = capabilityBadges(model);
  if (!context && !price && !badges.length) return null;
  return (
    <span data-model-badges className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {context && <span className={CHIP} title={t("models.badge.contextHint")}>{context}</span>}
      {price && <span className={cn(CHIP, "tabular-nums")} title={t("models.badge.priceHint")}>{price}</span>}
      {badges.map((badge) => <span key={badge} data-badge={badge} className={CHIP}>{t(`models.badge.${badge}`)}</span>)}
    </span>
  );
}
