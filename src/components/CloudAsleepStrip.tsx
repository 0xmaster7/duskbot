import { useEffect, useReducer } from "react";
import { cloudSendWaiting, cloudWaking, onCloudWaking } from "@/lib/cloud-power";
import { t } from "@/lib/i18n";

/** While a Cloud home that slept is coming back (src/lib/cloud-power.ts), a quiet connecting line; never anything else. */
export function CloudAsleepStrip() {
  const [, changed] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onCloudWaking(changed), []);
  if (!cloudWaking()) return null;
  return <div role="status" data-cloud-asleep="waking" className="flex items-center justify-center gap-2 px-3 py-1.5 text-[13px] text-ink-secondary">
    <span aria-hidden="true" className="size-3 shrink-0 animate-spin rounded-full border-2 border-transparent border-t-accent motion-reduce:animate-none" />
    <span>{t(cloudSendWaiting() ? "cloudAsleep.wakingSend" : "cloudAsleep.waking")}</span>
  </div>;
}
