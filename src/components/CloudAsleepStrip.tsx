import { useEffect, useReducer, useState } from "react";
import { Moon } from "../icons";
import { cloudAsleep, cloudSendWaiting, cloudWaking, markCloudAwake, onCloudPower, onCloudWaking } from "@/lib/cloud-power";
import { t } from "@/lib/i18n";

/** A Cloud home on a plan that sleeps went to sleep (src/lib/cloud-power.ts): this page sends nothing until the person
 * types or clicks, which wakes it; meanwhile the line says it is waking. Never shown on any other server. */
export function CloudAsleepStrip() {
  const [asleep, setAsleep] = useState(cloudAsleep);
  const [, changed] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onCloudPower(setAsleep), []);
  useEffect(() => onCloudWaking(changed), []);
  const waking = cloudWaking(), sending = cloudSendWaiting();
  if (!asleep && !waking) return null;
  return <div role="status" data-cloud-asleep={waking ? "waking" : "asleep"} className="flex items-center justify-center gap-2 px-3 py-1.5 text-[13px] text-ink-secondary">
    {waking
      ? <span aria-hidden="true" className="size-3 shrink-0 animate-spin rounded-full border-2 border-hairline border-t-accent motion-reduce:animate-none" />
      : <Moon size={14} aria-hidden="true" />}
    <span>{t(sending ? "cloudAsleep.wakingSend" : waking ? "cloudAsleep.waking" : "cloudAsleep.line")}</span>
    {!waking && <button type="button" className="font-medium text-accent-text underline underline-offset-2 hover:text-ink" onClick={() => markCloudAwake("click")}>{t("cloudPower.wake")}</button>}
  </div>;
}
