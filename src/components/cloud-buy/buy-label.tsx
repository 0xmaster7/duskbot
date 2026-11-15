import type { ReactNode } from "react";
import { RollingText } from "@/components/ui/RollingText";
import { t } from "@/lib/i18n";

/** "Get {plan} for {price}/month", its price digits rolling as the plan changes. */
export function buyLabel(plan: string, price: string): ReactNode {
  return <RollingText text={t("cloudBuy.buy", { plan, price })} />;
}
