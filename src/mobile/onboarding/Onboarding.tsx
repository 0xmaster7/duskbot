import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft, ClipboardPaste, RotateCw, ScanLine, X } from "../../icons";
import { WorkingDots } from "@/components/WorkingIndicator";
import { productName } from "@/lib/brand";
import { t } from "@/lib/i18n";
import type { MobileConnectionRecord } from "../../../shared/mobile-link";
import { haptic } from "../haptics";
import { dur, ease } from "../motion";
import { usePlatform, type CameraPermission } from "../platform";
import { PairError, parseTypedPairing, redeemPairing, resolveTypedCode, type TypedPairing } from "../connection/pair";
import { IntroPager } from "./IntroPager";
import { Scanner } from "./Scanner";
import { AccountStep } from "./AccountStep";
import { CloudPicker } from "../account/CloudPicker";
import { accountService, signedInAccount } from "./account";
import { enterDemo } from "../demo/demo-mode";
import { MascotTrio, ONBOARDING_BG, SkyScene } from "./SkyScene";

type Step = "intro" | "account" | "link" | "permission" | "denied" | "scan" | "code" | "paste";
type Failure = { code: PairError["code"]; name: string; companion: boolean };

const INTRO_SEEN = "omb.mobile.introSeen";
export const PRIMARY = "mobile-press flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#f3f4f8] text-[17px] font-semibold text-[#121212] disabled:opacity-60";
export const QUIET = "mobile-press h-12 w-full rounded-full text-[15px] font-medium text-white/70 disabled:opacity-60";

function installationName(payload: TypedPairing | null): string {
  if (payload?.name) return payload.name;
  try { return new URL(payload?.origin ?? "").host; } catch { return t("mobile.pair.workspace"); }
}

/** step swap: in from y 6, out to y -4, opacity on its own clock (bencho step-swap) */
function StepPane({ id, children }: { id: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div key={id} className="absolute inset-0 flex flex-col"
      initial={{ opacity: 0, y: reduced ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -4, transition: { duration: dur.fast } }}
      transition={{ duration: dur.base, ease: ease.out }}>
      {children}
    </motion.div>
  );
}

function FailurePanel({ failure, onRetry }: { failure: Failure; onRetry: () => void }) {
  const key = failure.code === "unreachable" && failure.companion ? "network" : failure.code;
  return (
    <motion.div role="alert" className="mt-6 w-full rounded-[20px] bg-white/[0.06] p-4 text-left"
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.base, ease: ease.out }}>
      <p className="text-[16px] font-semibold text-white">{t(`mobile.onboarding.err.${key}.title` as Parameters<typeof t>[0])}</p>
      <p className="mt-1 text-[14px] leading-[1.45] text-white/60">{t(`mobile.onboarding.err.${key}.body` as Parameters<typeof t>[0], { name: failure.name })}</p>
      <button type="button" onClick={onRetry} className="mobile-press mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white/[0.1] text-[15px] font-medium text-white"><RotateCw size={16} />{t("mobile.onboarding.retry")}</button>
    </motion.div>
  );
}

/** The one shape every onboarding screen takes: a top row that only ever holds back or close (art never goes up there,
 * by the Dynamic Island), a centred middle (the mascots above the words when the screen has art), actions at the bottom. */
export function Screen({ top, art = true, children, actions }: { top?: ReactNode; art?: boolean; children: ReactNode; actions: ReactNode }) {
  return (
    <>
      <div className="flex h-[calc(var(--m-safe-top)+60px)] shrink-0 items-end px-4 pb-2">{top}</div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-7 text-center">
        {art && <MascotTrio className="mb-9" />}
        {children}
      </div>
      <div className="flex shrink-0 flex-col items-center gap-2 px-6 pb-[calc(var(--m-safe-bottom)+16px)] pt-4">{actions}</div>
    </>
  );
}

export const HEADLINE = "text-[28px] font-semibold leading-[1.15] tracking-tight text-white";
export const LINE = "mx-auto mt-3 max-w-[300px] text-[16px] leading-[1.5] text-white/60";

/** First launch to linked: who this is, link to your installation by scanning the desktop's QR (or a code, or a link),
 * and hand the record back. The success moment and the hand-off to Home belong to the connection gate. */
export function Onboarding({ initial = null, reason = null, startAtLink = false, onLinked, onCancel }: {
  initial?: TypedPairing | null;
  /** Linking another installation from inside the app: no intro, and a way back out. */
  startAtLink?: boolean;
  reason?: "revoked" | null;
  onLinked(record: MobileConnectionRecord, token: string, name: string): void | Promise<void>;
  onCancel?: () => void;
}) {
  const platform = usePlatform();
  const [step, setStep] = useState<Step | null>(initial || reason || startAtLink ? "link" : null);
  const [confirm, setConfirm] = useState<TypedPairing | null>(initial);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [value, setValue] = useState("");
  const lastTry = useRef<(() => void) | null>(null);
  const locked = useRef(false);
  const fieldId = useId();

  useEffect(() => {
    if (step) return;
    void platform.prefs.get(INTRO_SEEN).then((seen) => { if (seen) void afterIntro(); else setStep("intro"); });
  }, [platform, step]);
  useEffect(() => { platform.setStatusBar?.("light"); }, [platform]);

  const go = (next: Step) => { setFailure(null); setValue(""); lastTry.current = null; setStep(next); };
  const service = accountService();
  /** After the intro: the account step while accounts are on and this phone has none yet, else straight to linking. */
  const afterIntro = async () => go(service && !(await signedInAccount(platform).catch(() => false)) ? "account" : "link");
  const finishIntro = () => { void platform.prefs.set(INTRO_SEEN, "1"); void afterIntro(); };

  const redeem = async (text: string | TypedPairing, from: Step) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setFailure(null);
    lastTry.current = () => void redeem(text, from);
    let payload: TypedPairing | null = typeof text === "string" ? null : text;
    try {
      if (typeof text === "string") {
        const parsed = parseTypedPairing(text);
        payload = parsed && "kind" in parsed ? await resolveTypedCode(parsed.code) : parsed;
      }
      if (!payload) throw new PairError("invalid");
      const result = await redeemPairing(payload, platform);
      await onLinked(result.record, result.token, result.record.label || installationName(payload));
    } catch (error) {
      haptic("error");
      setFailure({ code: error instanceof PairError ? error.code : "unreachable", name: installationName(payload), companion: payload?.transport === "companion" });
      if (from === "scan") setStep("link");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const openScanner = async () => {
    setFailure(null);
    const camera = platform.camera;
    if (!camera) { go("code"); return; }
    const state: CameraPermission = await camera.permission().catch(() => "prompt");
    go(state === "granted" ? "scan" : state === "denied" ? "denied" : "permission");
  };
  const askCamera = async () => {
    const state = await platform.camera?.request().catch(() => "denied" as const);
    // the OS prompt pauses the app; the camera only opens once it is back in front
    if (state === "granted") await new Promise((resolve) => setTimeout(resolve, 450));
    go(state === "granted" ? "scan" : "denied");
  };
  const paste = async () => {
    const text = await platform.readClipboard?.();
    if (text) setValue(text.trim());
  };

  const back = (
    <button type="button" onClick={() => go(step === "paste" ? "code" : "link")} aria-label={t("mobile.sheet.back")} className="mobile-press flex size-11 items-center justify-center rounded-full bg-white/[0.1] text-white"><ChevronLeft size={21} /></button>
  );

  return (
    <main className="omb-mobile omb-onboarding relative size-full overflow-hidden" style={{ background: ONBOARDING_BG }} data-scan-clear aria-busy={busy}>
      <SkyScene>
        <AnimatePresence mode="wait" initial={false}>
          {step === "intro" && (
            <StepPane id="intro"><IntroPager onPage={() => {}} onDone={finishIntro} /></StepPane>
          )}

          {step === "account" && service && (
            <StepPane id="account">
              <Screen actions={null}>
                <AccountStep platform={platform} service={service} onDone={() => go("link")} />
              </Screen>
            </StepPane>
          )}

          {step === "link" && confirm && (
            <StepPane id="confirm">
              <Screen actions={<>
                <button type="button" disabled={busy} className={PRIMARY} onClick={() => void redeem(confirm, "link")}>{busy ? <WorkingDots /> : t("mobile.pair.link")}</button>
                <button type="button" disabled={busy} className={QUIET} onClick={() => { setConfirm(null); setFailure(null); onCancel?.(); }}>{t("mobile.pair.cancel")}</button>
              </>}>
                <h1 className={HEADLINE}>{t("mobile.pair.confirm", { name: installationName(confirm) })}</h1>
                <p className={LINE}>{t("mobile.onboarding.confirmBody")}</p>
                {failure && <FailurePanel failure={failure} onRetry={() => lastTry.current?.()} />}
              </Screen>
            </StepPane>
          )}

          {step === "link" && !confirm && (
            <StepPane id="link">
              <Screen
                top={startAtLink && onCancel ? <button type="button" onClick={onCancel} aria-label={t("mobile.sheet.close")} className="mobile-press flex size-11 items-center justify-center rounded-full bg-white/[0.08] text-white"><X size={20} /></button> : null}
                actions={<>
                  <button type="button" disabled={busy} className={PRIMARY} onClick={() => void openScanner()}><ScanLine size={20} />{t("mobile.onboarding.scan")}</button>
                  <button type="button" disabled={busy} className={QUIET} onClick={() => go("code")}>{t("mobile.onboarding.codeInstead")}</button>
                  {!startAtLink && <button type="button" disabled={busy} className={QUIET} onClick={() => void enterDemo(platform)}>{t("mobile.demo.try")}</button>}
                </>}>
                {reason === "revoked" && <p role="status" className="mb-3 text-[14px] text-white/60">{t("mobile.pair.revoked")}</p>}
                <h1 className={HEADLINE}>{t("mobile.onboarding.linkTitle")}</h1>
                <p className={LINE}>{t("mobile.onboarding.linkShort", { app: productName() })}</p>
                <CloudPicker busy={busy} onPairing={(payload) => redeem(payload, "link")} />
                {failure && <FailurePanel failure={failure} onRetry={() => (lastTry.current ? lastTry.current() : void openScanner())} />}
              </Screen>
            </StepPane>
          )}

          {(step === "permission" || step === "denied") && (
            <StepPane id={step}>
              <Screen top={back} actions={<>
                {step === "permission"
                  ? <button type="button" className={PRIMARY} onClick={() => void askCamera()}>{t("mobile.onboarding.allowCamera")}</button>
                  : platform.camera?.openSettings && <button type="button" className={PRIMARY} onClick={() => void platform.camera?.openSettings?.()}>{t("mobile.onboarding.openSettings")}</button>}
                <button type="button" className={QUIET} onClick={() => go("code")}>{t("mobile.onboarding.codeInstead")}</button>
              </>}>
                <h1 className={HEADLINE}>{t(step === "denied" ? "mobile.onboarding.deniedTitle" : "mobile.onboarding.cameraTitle")}</h1>
                <p className={LINE}>{t(step === "denied" ? "mobile.onboarding.deniedBody" : "mobile.onboarding.cameraBody")}</p>
              </Screen>
            </StepPane>
          )}

          {(step === "code" || step === "paste") && (
            <StepPane id={step}>
              <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); if (value.trim()) void redeem(value, step); }}>
                <div className="flex h-[calc(var(--m-safe-top)+60px)] shrink-0 items-end px-4 pb-2">{back}</div>
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-6">
                  <h1 className={HEADLINE}>{t(step === "code" ? "mobile.onboarding.codeTitle" : "mobile.onboarding.pasteTitle")}</h1>
                  <p className="mt-2 text-[16px] leading-[1.5] text-white/60">{t(step === "code" ? "mobile.onboarding.codeBody" : "mobile.onboarding.pasteBody")}</p>
                  <label htmlFor={fieldId} className="sr-only">{t(step === "code" ? "mobile.onboarding.codeLabel" : "mobile.onboarding.pasteLabel")}</label>
                  {step === "code" ? (
                    <input id={fieldId} autoFocus value={value} disabled={busy}
                      onChange={(event) => setValue(formatCode(event.target.value))}
                      inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="one-time-code" placeholder="XXXX-XXXX-XXXX" maxLength={14}
                      className="mt-8 h-16 w-full min-w-0 rounded-[20px] bg-white/[0.07] text-center font-mono text-[22px] tracking-[0.14em] text-white placeholder:text-white/25 focus:bg-white/[0.1]" />
                  ) : (
                    <div className="mt-8 flex w-full gap-2">
                      <input id={fieldId} autoFocus value={value} disabled={busy} onChange={(event) => setValue(event.target.value)}
                        inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="duskbot://pair?..."
                        className="h-14 min-w-0 flex-1 rounded-[18px] bg-white/[0.07] px-4 text-[16px] text-white placeholder:text-white/30" />
                      {platform.readClipboard && <button type="button" onClick={() => void paste()} aria-label={t("mobile.onboarding.pasteFromClipboard")} className="mobile-press flex size-14 shrink-0 items-center justify-center rounded-[18px] bg-white/[0.08] text-white"><ClipboardPaste size={20} /></button>}
                    </div>
                  )}
                  {failure && <FailurePanel failure={failure} onRetry={() => lastTry.current?.()} />}
                </div>
                <div className="flex shrink-0 flex-col items-center gap-2 px-6 pb-[calc(var(--m-safe-bottom)+16px)] pt-4">
                  <button type="submit" disabled={busy || !value.trim() || (step === "code" && value.replace(/-/g, "").length < 12)} className={PRIMARY}>{busy ? <WorkingDots /> : t("mobile.pair.link")}</button>
                  {step === "code" && <button type="button" className={QUIET} onClick={() => { setValue(""); setFailure(null); setStep("paste"); }}>{t("mobile.onboarding.pasteInstead")}</button>}
                </div>
              </form>
            </StepPane>
          )}
        </AnimatePresence>
      </SkyScene>

      <AnimatePresence>
        {step === "scan" && (
          <Scanner key="scan" platform={platform} busy={busy}
            onCode={(text) => void redeem(text, "scan")}
            onClose={() => go("link")} onEnterCode={() => go("code")} onPaste={() => go("paste")} />
        )}
      </AnimatePresence>
    </main>
  );
}

/** XXXX-XXXX-XXXX as the person types: letters and digits only, uppercase, dashes added. */
export function formatCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return raw.replace(/(.{4})(?=.)/g, "$1-");
}
