import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from "motion/react";
import { Camera, ChevronLeft, ClipboardPaste, KeyRound, Link2, QrCode, RotateCw, ScanLine, X } from "lucide-react";
import { MausAvatar } from "@/components/Avatar";
import { WorkingDots } from "@/components/WorkingIndicator";
import { productName } from "@/lib/brand";
import { t } from "@/lib/i18n";
import type { MobileConnectionRecord } from "../../../shared/mobile-link";
import { haptic } from "../haptics";
import { dur, ease } from "../motion";
import { usePlatform, type CameraPermission } from "../platform";
import { PairError, parseTypedPairing, redeemPairing, resolveTypedCode, type TypedPairing } from "../connection/pair";
import { IntroPager, SyncGlyphs } from "./IntroPager";
import { Scanner } from "./Scanner";
import { SkyScene, type SkyStage } from "./SkyScene";

type Step = "intro" | "link" | "permission" | "denied" | "scan" | "code" | "paste";
type Failure = { code: PairError["code"]; name: string; companion: boolean };

const INTRO_SEEN = "omb.mobile.introSeen";
const PRIMARY = "mobile-press flex h-14 w-full items-center justify-center gap-2 rounded-full bg-[#f3f4f8] text-[17px] font-semibold text-[#0b0d14] disabled:opacity-60";
const SECONDARY = "mobile-press flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-white/[0.09] px-4 text-[15px] font-medium text-white ring-1 ring-white/10 disabled:opacity-60";

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

/** Where the code is on the computer, drawn small: the desktop app's Settings, Phone, with its QR. */
function WhereIsTheCode() {
  return (
    <div aria-hidden className="relative mx-auto mt-6 h-[150px] w-[250px] rounded-[16px] bg-white/[0.06] ring-1 ring-white/[0.12]">
      <div className="flex h-7 items-center gap-1.5 border-b border-white/[0.08] px-3">
        {[0, 1, 2].map((i) => <span key={i} className="size-2 rounded-full bg-white/20" />)}
        <span className="ms-3 text-[11px] font-medium text-white/55">{t("mobile.onboarding.illustrationPath")}</span>
      </div>
      <div className="flex h-[122px]">
        <div className="flex w-16 flex-col gap-2 border-e border-white/[0.08] p-2.5">
          {[0.5, 0.3, 0.3, 0.3].map((o, i) => <span key={i} className="h-1.5 rounded-full bg-white" style={{ opacity: o * 0.5, width: i === 0 ? "100%" : "75%" }} />)}
        </div>
        <div className="relative flex flex-1 items-center justify-center">
          <span className="relative flex size-[74px] items-center justify-center rounded-[12px] bg-white text-[#0b0d14]">
            <QrCode size={58} strokeWidth={1.4} />
            <span className="absolute -right-5 -top-6"><MausAvatar color="orange" bodyId="flower" size={34} state="happy" gaze={{ x: -1, y: 1 }} label="" /></span>
          </span>
        </div>
      </div>
    </div>
  );
}

function FailurePanel({ failure, onRetry }: { failure: Failure; onRetry: () => void }) {
  const key = failure.code === "unreachable" && failure.companion ? "network" : failure.code;
  return (
    <motion.div role="alert" className="mt-5 rounded-[20px] bg-white/[0.07] p-4 ring-1 ring-white/10"
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.base, ease: ease.out }}>
      <div className="flex items-start gap-3">
        <MausAvatar color="coral" bodyId="pebble" size={36} state="sad" label="" />
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold text-white">{t(`mobile.onboarding.err.${key}.title` as Parameters<typeof t>[0])}</p>
          <p className="mt-1 text-[14px] leading-[1.45] text-white/65">{t(`mobile.onboarding.err.${key}.body` as Parameters<typeof t>[0], { name: failure.name })}</p>
        </div>
      </div>
      <button type="button" onClick={onRetry} className="mobile-press mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white/[0.12] text-[15px] font-medium text-white"><RotateCw size={16} />{t("mobile.onboarding.retry")}</button>
    </motion.div>
  );
}

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
  const drag = useMotionValue(0);
  const [step, setStep] = useState<Step | null>(initial || reason || startAtLink ? "link" : null);
  const [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState<TypedPairing | null>(initial);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [value, setValue] = useState("");
  const lastTry = useRef<(() => void) | null>(null);
  const locked = useRef(false);
  const fieldId = useId();

  useEffect(() => {
    if (step) return;
    void platform.prefs.get(INTRO_SEEN).then((seen) => setStep(seen ? "link" : "intro"));
  }, [platform, step]);
  useEffect(() => { platform.setStatusBar?.("light"); }, [platform]);

  const go = (next: Step) => { setFailure(null); setValue(""); lastTry.current = null; setStep(next); };
  const finishIntro = () => { void platform.prefs.set(INTRO_SEEN, "1"); go("link"); };

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

  const stage: SkyStage = step === "intro" ? (["intro0", "intro1", "intro2"] as const)[page] : step === "scan" ? "scan" : step === "code" || step === "paste" ? "form" : "link";
  const back = (
    <button type="button" onClick={() => go("link")} aria-label={t("mobile.sheet.back")} className="mobile-press flex size-11 items-center justify-center rounded-full bg-white/[0.1] text-white"><ChevronLeft size={21} /></button>
  );

  return (
    <main className="omb-mobile omb-onboarding relative size-full overflow-hidden bg-[#0b0d14]" data-scan-clear aria-busy={busy}>
      <SkyScene stage={stage} drag={drag} glyphs={<SyncGlyphs shown={step === "intro" && page === 1} />}>
        <AnimatePresence mode="wait" initial={false}>
          {step === "intro" && (
            <StepPane id="intro"><IntroPager drag={drag} onPage={setPage} onDone={finishIntro} /></StepPane>
          )}

          {step === "link" && (
            <StepPane id={confirm ? "confirm" : "link"}>
              {startAtLink && onCancel && !confirm && (
                <div className="px-4 pt-[calc(var(--m-safe-top)+8px)]">
                  <button type="button" onClick={onCancel} aria-label={t("mobile.sheet.close")} className="mobile-press flex size-11 items-center justify-center rounded-full bg-white/[0.1] text-white"><X size={20} /></button>
                </div>
              )}
              <div className="flex-1" />
              <div className="px-6 pb-[calc(var(--m-safe-bottom)+20px)]">
                {confirm ? (
                  <>
                    <h1 className="text-center text-[28px] font-semibold leading-[1.15] tracking-tight text-white">{t("mobile.pair.confirm", { name: installationName(confirm) })}</h1>
                    <p className="mx-auto mt-2 max-w-[300px] text-center text-[15px] leading-6 text-white/60">{t("mobile.onboarding.confirmBody")}</p>
                    {failure && <FailurePanel failure={failure} onRetry={() => lastTry.current?.()} />}
                    <div className="mt-6 flex flex-col gap-3">
                      <button type="button" disabled={busy} className={PRIMARY} onClick={() => void redeem(confirm, "link")}>{busy ? <WorkingDots /> : t("mobile.pair.link")}</button>
                      <button type="button" disabled={busy} className="mobile-press h-12 rounded-full text-[15px] font-medium text-white/70" onClick={() => { setConfirm(null); setFailure(null); onCancel?.(); }}>{t("mobile.pair.cancel")}</button>
                    </div>
                  </>
                ) : (
                  <>
                    {reason === "revoked" && <p role="status" className="mb-3 text-center text-[14px] text-white/65">{t("mobile.pair.revoked")}</p>}
                    <h1 className="text-center text-[28px] font-semibold leading-[1.15] tracking-tight text-white">{t("mobile.onboarding.linkTitle")}</h1>
                    <p className="mx-auto mt-2 max-w-[310px] text-center text-[15px] leading-6 text-white/60">{t("mobile.onboarding.linkBody", { app: productName() })}</p>
                    <WhereIsTheCode />
                    {failure && <FailurePanel failure={failure} onRetry={() => (lastTry.current ? lastTry.current() : void openScanner())} />}
                    <div className="mt-6 flex flex-col gap-3">
                      <button type="button" disabled={busy} className={PRIMARY} onClick={() => void openScanner()}><ScanLine size={20} />{t("mobile.onboarding.scan")}</button>
                      <div className="flex gap-3">
                        <button type="button" disabled={busy} className={SECONDARY} onClick={() => go("code")}><KeyRound size={17} />{t("mobile.onboarding.enterCode")}</button>
                        <button type="button" disabled={busy} className={SECONDARY} onClick={() => go("paste")}><Link2 size={17} />{t("mobile.onboarding.pasteLink")}</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </StepPane>
          )}

          {(step === "permission" || step === "denied") && (
            <StepPane id={step}>
              <div className="px-4 pt-[calc(var(--m-safe-top)+8px)]">{back}</div>
              <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
                <div className="relative flex size-28 items-center justify-center rounded-[34px] bg-white/[0.08] ring-1 ring-white/10">
                  <Camera size={46} strokeWidth={1.5} className="text-white/85" />
                  <span className="absolute -right-6 -top-7"><MausAvatar color="green" bodyId="bean" size={46} state={step === "denied" ? "sad" : "curious"} gaze={{ x: -1, y: 1 }} label="" /></span>
                </div>
                <h1 className="mt-8 text-[26px] font-semibold tracking-tight text-white">{t(step === "denied" ? "mobile.onboarding.deniedTitle" : "mobile.onboarding.cameraTitle")}</h1>
                <p className="mt-2 max-w-[300px] text-[15px] leading-6 text-white/60">{t(step === "denied" ? "mobile.onboarding.deniedBody" : "mobile.onboarding.cameraBody")}</p>
              </div>
              <div className="flex flex-col gap-3 px-6 pb-[calc(var(--m-safe-bottom)+20px)]">
                {step === "permission"
                  ? <button type="button" className={PRIMARY} onClick={() => void askCamera()}>{t("mobile.onboarding.allowCamera")}</button>
                  : platform.camera?.openSettings && <button type="button" className={PRIMARY} onClick={() => void platform.camera?.openSettings?.()}>{t("mobile.onboarding.openSettings")}</button>}
                <button type="button" className="mobile-press h-12 rounded-full text-[15px] font-medium text-white/75" onClick={() => go("code")}>{t("mobile.onboarding.codeInstead")}</button>
              </div>
            </StepPane>
          )}

          {(step === "code" || step === "paste") && (
            <StepPane id={step}>
              <div className="px-4 pt-[calc(var(--m-safe-top)+8px)]">{back}</div>
              <form className="flex flex-1 flex-col px-6 pt-10" onSubmit={(event) => { event.preventDefault(); if (value.trim()) void redeem(value, step); }}>
                <h1 className="text-[28px] font-semibold tracking-tight text-white">{t(step === "code" ? "mobile.onboarding.codeTitle" : "mobile.onboarding.pasteTitle")}</h1>
                <p className="mt-2 text-[15px] leading-6 text-white/60">{t(step === "code" ? "mobile.onboarding.codeBody" : "mobile.onboarding.pasteBody")}</p>
                <label htmlFor={fieldId} className="sr-only">{t(step === "code" ? "mobile.onboarding.codeLabel" : "mobile.onboarding.pasteLabel")}</label>
                {step === "code" ? (
                  <input id={fieldId} autoFocus value={value} disabled={busy}
                    onChange={(event) => setValue(formatCode(event.target.value))}
                    inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="one-time-code" placeholder="XXXX-XXXX-XXXX" maxLength={14}
                    className="mt-8 h-16 w-full rounded-[20px] bg-white/[0.07] text-center font-mono text-[24px] tracking-[0.18em] text-white ring-1 ring-white/12 placeholder:text-white/25 focus:bg-white/[0.1]" />
                ) : (
                  <div className="mt-8 flex gap-2">
                    <input id={fieldId} autoFocus value={value} disabled={busy} onChange={(event) => setValue(event.target.value)}
                      inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="openmausbot://pair?..."
                      className="h-14 min-w-0 flex-1 rounded-[18px] bg-white/[0.07] px-4 text-[16px] text-white ring-1 ring-white/12 placeholder:text-white/30" />
                    {platform.readClipboard && <button type="button" onClick={() => void paste()} aria-label={t("mobile.onboarding.pasteFromClipboard")} className="mobile-press flex size-14 items-center justify-center rounded-[18px] bg-white/[0.1] text-white"><ClipboardPaste size={20} /></button>}
                  </div>
                )}
                {failure && <FailurePanel failure={failure} onRetry={() => lastTry.current?.()} />}
                <div className="flex-1" />
                <div className="pb-[calc(var(--m-safe-bottom)+20px)] pt-6">
                  <button type="submit" disabled={busy || !value.trim() || (step === "code" && value.replace(/-/g, "").length < 12)} className={PRIMARY}>{busy ? <WorkingDots /> : t("mobile.pair.link")}</button>
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
