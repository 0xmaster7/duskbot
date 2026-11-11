import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Mail, RotateCw } from "lucide-react";
import { MausAvatar } from "@/components/Avatar";
import { WorkingDots } from "@/components/WorkingIndicator";
import { t } from "@/lib/i18n";
import { haptic } from "../haptics";
import { dur, ease } from "../motion";
import type { MobilePlatform } from "../platform";
import { AccountError, finishAccountSignIn, parseAuthLink, startAccountSignIn, type AccountProvider } from "./account";

/** Brand marks as each provider publishes them (single-colour paths), not icons of ours. */
export const MARKS: Record<Exclude<AccountProvider, "email">, ReactNode> = {
  apple: <svg viewBox="0 0 24 24" className="size-[19px]" aria-hidden><path fill="currentColor" d="M16.37 12.6c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.27-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.42-3.66zM14.1 5.84c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.67 1.37-.58.67-1.1 1.76-.96 2.8 1.02.08 2.06-.52 2.69-1.28z" /></svg>,
  google: <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden><path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.17 3.57-8.8z" /><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.87-3c-1.08.72-2.45 1.15-4.08 1.15-3.13 0-5.79-2.12-6.74-4.97H1.27v3.1A12 12 0 0 0 12 24z" /><path fill="#FBBC05" d="M5.26 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.27a12 12 0 0 0 0 10.76z" /><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.62l3.99 3.1C6.21 6.87 8.87 4.75 12 4.75z" /></svg>,
  x: <svg viewBox="0 0 24 24" className="size-[16px]" aria-hidden><path fill="currentColor" d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.63 7.58H.48l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93zm-1.29 19.5h2.04L6.48 3.24H4.3l13.31 17.41z" /></svg>,
};

const ROW = "mobile-press flex h-14 w-full items-center justify-center gap-2.5 rounded-full text-[17px] font-semibold disabled:opacity-60";

/** Create an account or sign in (one set of buttons does both): the provider's own page opens in the system browser and
 * comes back through duskbot://auth, where this phone's PKCE verifier turns the code into its account token. */
export function AccountStep({ platform, service, onDone }: { platform: MobilePlatform; service: string; onDone: () => void }) {
  const [waiting, setWaiting] = useState<AccountProvider | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<AccountError["code"] | null>(null);

  useEffect(() => platform.onAppUrl?.((url) => {
    const link = parseAuthLink(url);
    if (!link) return false;
    setFinishing(true);
    setError(null);
    void finishAccountSignIn(platform, service, link)
      .then(() => { haptic("success"); onDone(); })
      .catch((failure) => { haptic("error"); setError(failure instanceof AccountError ? failure.code : "oauth_failed"); setWaiting(null); })
      .finally(() => setFinishing(false));
    return true;
  }), [platform, service, onDone]);

  const start = (provider: AccountProvider) => {
    setError(null);
    setWaiting(provider);
    void startAccountSignIn(platform, service, provider).catch(() => { setWaiting(null); setError("network"); haptic("error"); });
  };

  return (
    <div className="w-full">
      <h1 className="text-center text-[28px] font-semibold leading-[1.15] tracking-tight text-white">{t("mobile.account.title")}</h1>
      <p className="mx-auto mt-2 max-w-[310px] text-center text-[15px] leading-6 text-white/60">{t("mobile.account.body")}</p>
      <AnimatePresence mode="wait" initial={false}>
        {waiting || finishing ? (
          <motion.div key="waiting" role="status" className="mt-8 flex flex-col items-center gap-4 text-center"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: dur.fast } }} transition={{ duration: dur.base, ease: ease.out }}>
            <MausAvatar color="blue" bodyId="blob" size={56} state="working" label="" />
            <p className="text-[16px] font-medium text-white">{t(finishing ? "mobile.account.finishing" : "mobile.account.inBrowser")}</p>
            {!finishing && <button type="button" onClick={() => setWaiting(null)} className="mobile-press h-11 rounded-full px-5 text-[15px] font-medium text-white/70">{t("mobile.pair.cancel")}</button>}
            {finishing && <WorkingDots />}
          </motion.div>
        ) : (
          <motion.div key="choose" className="mt-7 flex flex-col gap-3"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: dur.fast } }} transition={{ duration: dur.base, ease: ease.out }}>
            {error && (
              <div role="alert" className="mb-1 flex items-start gap-3 rounded-[20px] bg-white/[0.07] p-4 ring-1 ring-white/10">
                <MausAvatar color="coral" bodyId="pebble" size={32} state="sad" label="" />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-white">{t(`mobile.account.err.${error}` as Parameters<typeof t>[0])}</p>
                  <button type="button" onClick={() => setError(null)} className="mt-1 flex items-center gap-1.5 text-[14px] text-white/65"><RotateCw size={14} />{t("mobile.onboarding.retry")}</button>
                </div>
              </div>
            )}
            <button type="button" onClick={() => start("apple")} className={`${ROW} bg-[#f3f4f8] text-[#121212]`}>{MARKS.apple}{t("mobile.account.apple")}</button>
            <button type="button" onClick={() => start("google")} className={`${ROW} bg-white/[0.1] text-white ring-1 ring-white/10`}>{MARKS.google}{t("mobile.account.google")}</button>
            <div className="flex gap-3">
              <button type="button" onClick={() => start("x")} className={`${ROW} flex-1 bg-white/[0.1] text-[15px] text-white ring-1 ring-white/10`}>{MARKS.x}{t("mobile.account.x")}</button>
              <button type="button" onClick={() => start("email")} className={`${ROW} flex-1 bg-white/[0.1] text-[15px] text-white ring-1 ring-white/10`}><Mail size={18} />{t("mobile.account.email")}</button>
            </div>
            <p className="mt-2 text-center text-[13px] leading-5 text-white/45">{t("mobile.account.same")}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
