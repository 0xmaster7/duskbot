// Signing in to a dusk bot account, as one step of the first run: Google (and any other provider the account service
// offers) in the browser, or an emailed one-time code. The attempt and the token stay in main (funnel-account.ts).
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, LoaderCircle } from "../../icons";
import { CodeBoxes, codeDigits } from "@/components/cloud-buy/CodeBoxes";
import { problemLine } from "@/components/cloud-buy/SignInScreen";
import type { CloudSignInProblem } from "@/lib/cloud-plan";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { OAuthProvider } from "../../../shared/account-api";
import type { CloudSignInStart } from "../../../electron/cloud-account.mjs";
import type { FunnelAccount, FunnelAccountState } from "./funnel-account";
import { PRIMARY, QUIET, StepArt, StepFrame, TILE } from "./FunnelSteps";

function GoogleMark() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

const PROVIDER_LABEL: Record<OAuthProvider, Parameters<typeof t>[0]> = {
  google: "funnel.account.google", apple: "funnel.account.apple", x: "funnel.account.x",
};

export function AccountStep({ account, known, onDone, onSkip }: {
  account: FunnelAccount;
  /** what main said last, kept by the flow so a signed-in person sees who they are */
  known: FunnelAccountState | null;
  onDone: () => void;
  /** continue without an account, where the app works without one */
  onSkip: (() => void) | null;
}) {
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const [providers, setProviders] = useState<OAuthProvider[] | null>(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<Extract<CloudSignInStart, { outcome: "sent" }> | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [browser, setBrowser] = useState<OAuthProvider | null>(null);
  const [problem, setProblem] = useState<CloudSignInProblem | null>(null);
  const [triesLeft, setTriesLeft] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const locked = useRef(false);

  useEffect(() => {
    let alive = true;
    void account.providers().then((list) => { if (alive) setProviders(list); }, () => { if (alive) setProviders([]); });
    return () => { alive = false; };
  }, [account]);
  useEffect(() => { host.current?.querySelector<HTMLInputElement>("[data-autofocus]")?.focus(); }, [sent]);
  useEffect(() => {
    if (!sent) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [sent]);

  const run = async (work: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setProblem(null);
    try { await work(); } catch { setProblem("failed"); } finally { locked.current = false; setBusy(false); }
  };
  const send = () => run(async () => {
    const result = await account.emailStart(email.trim());
    if (result.outcome === "sent") { setSent(result); setEmail(result.email); setCode(""); setNow(Date.now()); }
    else setProblem(result.outcome);
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!sent) { if (email.trim()) void send(); return; }
    if (code.length !== 8) return;
    void run(async () => {
      const result = await account.emailVerify(code);
      if (result.outcome === "signed-in") onDone();
      else { setProblem(result.outcome); setTriesLeft(result.outcome === "wrong-code" ? result.triesLeft : null); }
    });
  };

  if (known?.signedIn) {
    return (
      <StepFrame art={<span className="place-mark grid size-14 place-items-center rounded-full bg-success/10 text-success"><Check size={26} aria-hidden="true" /></span>}
        title={t("funnel.account.signedInTitle")}
        sub={known.email ? t("funnel.account.signedIn", { email: known.email }) : undefined}
        footer={<button type="button" data-primary="" autoFocus onClick={onDone} className={PRIMARY}>{t("funnel.next")}</button>} />
    );
  }

  if (browser) {
    return (
      <StepFrame art={<StepArt art="key" />} title={t("funnel.account.browserTitle")} sub={t("funnel.account.browser")}
        footer={<>
          <p role="status" className="flex items-center gap-2 text-[13px] leading-[18px] text-ink-secondary">
            <LoaderCircle size={14} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />{t("funnel.account.waiting")}
          </p>
          <button type="button" className={QUIET} onClick={() => void account.cancelBrowser().catch(() => {}).finally(() => setBrowser(null))}>{t("funnel.cancel")}</button>
        </>} />
    );
  }

  return (
    <div ref={host} className="w-full">
      <StepFrame art={<StepArt art="key" />} title={t("funnel.account.title")} sub={t(sent ? "funnel.account.codeSub" : "funnel.account.sub", { email: sent?.email ?? "" })}
        footer={onSkip && !sent ? <button type="button" data-funnel-account-skip="" onClick={onSkip} className={QUIET}>{t("funnel.account.skip")}</button> : undefined}>
        <div className="flex w-full max-w-[320px] flex-col gap-3">
          {!sent && providers && providers.length > 0 && (
            <>
              {providers.map((provider) => (
                <button key={provider} type="button" data-funnel-provider={provider} disabled={busy}
                  onClick={() => void run(async () => { setBrowser(provider); await account.browser(provider); })}
                  className={cn(TILE, "flex min-h-11 w-full items-center justify-center gap-2.5 px-5 text-[14px] text-ink disabled:opacity-50")}>
                  {provider === "google" && <GoogleMark />}
                  {t(PROVIDER_LABEL[provider])}
                </button>
              ))}
              <p className="py-1 text-center text-[12px] leading-4 text-ink-tertiary">{t("funnel.account.or")}</p>
            </>
          )}
          <form onSubmit={submit} noValidate className="flex flex-col gap-3 text-start">
            {!sent ? (
              <>
                <label htmlFor={`${id}-email`} className="sr-only">{t("funnel.account.email")}</label>
                <input id={`${id}-email`} data-autofocus type="email" inputMode="email" autoComplete="email" spellCheck={false} disabled={busy}
                  value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("funnel.account.emailPlaceholder")}
                  aria-invalid={problem === "invalid-email" || undefined} aria-describedby={problem ? `${id}-problem` : undefined}
                  className="h-11 w-full rounded-xl bg-ink/[0.035] px-4 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-tertiary focus:bg-ink/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 motion-reduce:transition-none" />
              </>
            ) : (
              <>
                <p id={`${id}-code`} className="sr-only">{t("funnel.account.codeLabel")}</p>
                <CodeBoxes code={code} onCode={(value) => setCode(codeDigits(value))} busy={busy} wrong={problem === "wrong-code"} labelId={`${id}-code`} problemId={problem ? `${id}-problem` : undefined} />
              </>
            )}
            <button type="submit" data-primary="" disabled={busy || (sent ? code.length !== 8 : !email.trim())} className={cn(PRIMARY, "w-full")}>
              {busy ? t("funnel.account.checking") : sent ? t("funnel.account.verify") : t("funnel.account.send")}
            </button>
            {sent && (
              <div className="flex items-center justify-center gap-1">
                <button type="button" className={QUIET} disabled={busy} onClick={() => void run(async () => { await account.emailCancel(); setSent(null); setCode(""); })}>{t("funnel.account.change")}</button>
                <button type="button" className={cn(QUIET, "disabled:opacity-40")} disabled={busy || (problem !== "expired" && now < sent.resendAt)} onClick={() => void send()}>{t("funnel.account.resend")}</button>
              </div>
            )}
            {problem && <p id={`${id}-problem`} role="alert" className="text-center text-[13px] leading-[18px] text-danger">{problemLine(problem, triesLeft)}</p>}
          </form>
        </div>
      </StepFrame>
    </div>
  );
}
