import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { MausAvatar } from "@/components/Avatar";
import { WorkingDots } from "@/components/WorkingIndicator";
import { productName } from "@/lib/brand";
import { t } from "@/lib/i18n";
import type { MobileConnectionRecord } from "../../../shared/mobile-link";
import { dur, ease } from "../motion";
import { haptic } from "../haptics";
import { usePlatform } from "../platform";
import { PairError, parseTypedPairing, redeemPairing, resolveTypedCode, type TypedPairing } from "./pair";

const MASCOTS = [
  { color: "purple", bodyId: "flower", size: 100, left: "-32px", top: "10%" },
  { color: "green", bodyId: "bean", size: 78, left: "60%", top: "-26px" },
  { color: "orange", bodyId: "star", size: 110, left: "calc(100% - 68px)", top: "18%" },
  { color: "pink", bodyId: "heart", size: 86, left: "-38px", top: "52%" },
  { color: "teal", bodyId: "cloud", size: 96, left: "calc(100% - 48px)", top: "58%" },
  { color: "yellow", bodyId: "pebble", size: 70, left: "22%", top: "8%" },
] as const;

function workspaceName(payload: TypedPairing | null): string {
  if (payload?.name) return payload.name;
  try { return new URL(payload?.origin ?? "").host; } catch { return t("mobile.pair.workspace"); }
}

export function PairScreen({ initial = null, reason, onLinked, onCancel }: {
  initial?: TypedPairing | null;
  reason?: "revoked" | null;
  onLinked(record: MobileConnectionRecord, token: string): void | Promise<void>;
  onCancel?: () => void;
}) {
  const platform = usePlatform();
  const reduced = useReducedMotion();
  const inputId = useId();
  const [confirmed, setConfirmed] = useState(initial);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<"scan" | "link" | null>(null);
  const [error, setError] = useState<{ code: PairError["code"]; name: string } | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setConfirmed(initial); setError(null); }, [initial]);

  const link = async (source: "scan" | "link") => {
    if (locked.current) return;
    locked.current = true;
    setBusy(source);
    setError(null);
    let payload = confirmed;
    try {
      if (source === "scan") {
        const result = await platform.scanQr?.();
        if (!result || !mounted.current) return;
        const parsed = parseTypedPairing(result.text);
        payload = parsed && "kind" in parsed ? await resolveTypedCode(parsed.code) : parsed;
      } else if (!payload) {
        const parsed = parseTypedPairing(input);
        payload = parsed && "kind" in parsed ? await resolveTypedCode(parsed.code) : parsed;
      }
      if (!payload) throw new PairError("invalid");
      if (!mounted.current) return;
      const result = await redeemPairing(payload, platform);
      if (!mounted.current) return;
      haptic("success");
      await onLinked(result.record, result.token);
    } catch (failure) {
      if (!mounted.current) return;
      haptic("error");
      setError({ code: failure instanceof PairError ? failure.code : "unreachable", name: workspaceName(payload) });
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(null);
    }
  };
  const cancel = () => { setConfirmed(null); setError(null); onCancel?.(); };
  const label = (source: "scan" | "link", text: string) => busy === source
    ? <><WorkingDots /><span className="sr-only">{t("mobile.pair.working")}</span></>
    : text;
  const primary = "mobile-press flex h-12 min-w-12 items-center justify-center rounded-full bg-ink px-6 text-[16px] font-semibold text-app disabled:opacity-50";

  return (
    <main className="omb-mobile relative flex size-full flex-col bg-app text-ink">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        {MASCOTS.map((mascot, index) => (
          <motion.div
            key={mascot.bodyId}
            className="absolute"
            style={{ left: mascot.left, top: mascot.top }}
            animate={reduced ? { x: 0, y: 0, rotate: 0 } : { x: [-4, 4], y: [6, -6], rotate: [-4, 4] }}
            transition={{ duration: dur.long * (10 + index), ease: [ease.out[0], 0, 1 - ease.out[0], 1], repeat: Infinity, repeatType: "mirror", delay: -index * dur.long }}
          >
            <MausAvatar color={mascot.color} bodyId={mascot.bodyId} size={mascot.size} state="idle" animated={false} personality={false} trackPointer={false} />
          </motion.div>
        ))}
      </div>
      <div className="relative min-h-0 flex-1" style={{ paddingTop: "var(--m-safe-top)" }}>
        <div className="absolute inset-x-6 top-[56%] -translate-y-1/2 text-center">
          <h1 className="text-[34px] font-semibold tracking-tight">{productName()}</h1>
          <p className="mt-2 text-[16px] text-ink-secondary">{t("mobile.pair.tagline")}</p>
        </div>
      </div>
      <div className="relative max-h-[62%] shrink-0 overflow-y-auto px-6 pt-8" style={{ paddingBottom: "calc(var(--m-safe-bottom) + 20px)" }} aria-busy={Boolean(busy)}>
        {reason === "revoked" && <p role="status" className="mb-5 text-center text-[14px] text-ink-secondary">{t("mobile.pair.revoked")}</p>}
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={confirmed ? "confirm" : typing ? "typing" : "choose"}
            initial={{ opacity: 0, y: reduced ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -6 }}
            transition={{ duration: dur.base, ease: ease.out }} className="flex flex-col gap-3"
          >
            {confirmed ? (
              <>
                <p className="mb-2 text-center text-[16px] font-semibold">{t("mobile.pair.confirm", { name: workspaceName(confirmed) })}</p>
                <button type="button" disabled={Boolean(busy)} className={primary} onClick={() => void link("link")}>{label("link", t("mobile.pair.link"))}</button>
                <button type="button" disabled={Boolean(busy)} className="mobile-press h-12 rounded-full bg-ink/[0.06] px-6 text-[16px] font-semibold disabled:opacity-50" onClick={cancel}>{t("mobile.pair.cancel")}</button>
              </>
            ) : (
              <>
                {platform.scanQr && <button type="button" disabled={Boolean(busy)} className={primary} onClick={() => void link("scan")}>{label("scan", t("mobile.pair.scan"))}</button>}
                {typing ? (
                  <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void link("link"); }}>
                    <label htmlFor={inputId} className="sr-only">{t("mobile.pair.linkOrCode")}</label>
                    <input id={inputId} autoFocus type="text" inputMode="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" value={input} onChange={(event) => setInput(event.target.value)} disabled={Boolean(busy)} placeholder={t("mobile.pair.linkOrCode")} className="mobile-float h-12 min-w-0 flex-1 rounded-full bg-composer px-4 text-[16px] text-ink placeholder:text-ink-tertiary disabled:opacity-50" />
                    <button type="submit" disabled={Boolean(busy) || !input.trim()} className={primary}>{label("link", t("mobile.pair.link"))}</button>
                  </form>
                ) : <button type="button" disabled={Boolean(busy)} className="mobile-press h-12 rounded-full bg-ink/[0.06] px-6 text-[16px] font-semibold disabled:opacity-50" onClick={() => setTyping(true)}>{t("mobile.pair.enter")}</button>}
              </>
            )}
          </motion.div>
        </AnimatePresence>
        {error && <p role="alert" className="mt-4 text-center text-[14px] text-danger">{t(`mobile.pair.${error.code}`, { name: error.name })}</p>}
        <p className="mt-5 text-center text-[13px] leading-5 text-ink-tertiary">{t("mobile.pair.hint")}</p>
      </div>
    </main>
  );
}
