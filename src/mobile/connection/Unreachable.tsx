import { useEffect, useState } from "react";
import { ChevronRight, RotateCw } from "../../icons";
import { WorkingDots } from "@/components/WorkingIndicator";
import { t } from "@/lib/i18n";
import type { MobileConnectionRecord } from "../../../shared/mobile-link";
import { HEADLINE, LINE, PRIMARY, QUIET, Screen } from "../onboarding/Onboarding";
import { ONBOARDING_BG, SkyScene } from "../onboarding/SkyScene";

/** seconds before each automatic retry; the last one repeats */
export const RETRY_SECONDS = [5, 10, 20, 40, 60];

/** A saved installation that did not answer at launch: the link is kept, so this is never the pairing screen. It retries
 * on its own, on demand, when the phone comes back online, and lets the person open another saved installation. */
export function Unreachable({ record, others, attempts, trying, onRetry, onSwitch, onLink }: {
  record: MobileConnectionRecord;
  others: MobileConnectionRecord[];
  attempts: number;
  trying: boolean;
  onRetry(): void;
  onSwitch(id: string): void;
  onLink(): void;
}) {
  const wait = RETRY_SECONDS[Math.min(Math.max(attempts - 1, 0), RETRY_SECONDS.length - 1)]!;
  const [left, setLeft] = useState(wait);
  useEffect(() => {
    if (trying) return;
    setLeft(wait);
    const started = Date.now();
    const tick = setInterval(() => {
      const remaining = wait - Math.floor((Date.now() - started) / 1000);
      if (remaining <= 0) { clearInterval(tick); onRetry(); } else setLeft(remaining);
    }, 1000);
    return () => clearInterval(tick);
  }, [trying, wait, onRetry]);
  useEffect(() => {
    if (trying) return;
    window.addEventListener("online", onRetry);
    return () => window.removeEventListener("online", onRetry);
  }, [trying, onRetry]);

  return (
    <main className="omb-mobile omb-onboarding relative size-full overflow-hidden" style={{ background: ONBOARDING_BG }} aria-busy={trying}>
      <SkyScene>
        <div className="absolute inset-0 flex flex-col">
          <Screen actions={<>
            <button type="button" disabled={trying} className={PRIMARY} onClick={onRetry}>{trying ? <WorkingDots /> : <><RotateCw size={18} />{t("mobile.onboarding.retry")}</>}</button>
            <button type="button" className={QUIET} onClick={onLink}>{t("mobile.settings.link")}</button>
          </>}>
            <h1 className={HEADLINE}>{t("mobile.unreachable.title", { name: record.label })}</h1>
            <p className={LINE}>{t("mobile.unreachable.body")}</p>
            <p role="status" className="mt-4 text-[14px] text-white/45">{trying ? t("mobile.unreachable.trying") : t("mobile.unreachable.next", { seconds: left })}</p>
            {others.length > 0 && (
              <div className="mt-8 w-full max-w-[320px] text-left">
                <p className="px-1 pb-2 text-[13px] font-medium text-white/45">{t("mobile.unreachable.others")}</p>
                <div className="overflow-hidden rounded-[20px] bg-white/[0.06]">
                  {others.map((other) => (
                    <button key={other.id} type="button" disabled={trying} onClick={() => onSwitch(other.id)} className="mobile-press flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left text-[16px] font-medium text-white disabled:opacity-60">
                      <span className="min-w-0 flex-1 truncate">{other.label}</span>
                      <ChevronRight aria-hidden size={18} className="shrink-0 text-white/40" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Screen>
        </div>
      </SkyScene>
    </main>
  );
}
