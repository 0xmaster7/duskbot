import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import type { MobileDevice, MobilePairingRequest, MobilePairingResponse } from "../../shared/mobile-link";
import { companionBridge } from "@/lib/companion-bridge";
import { copyText, type CopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { api, ApiError } from "@/state/store";
import { lastSeen, minutesLeft } from "../lib/pairing-time";
import { haptic } from "../mobile/haptics";
import { dur, ease } from "../mobile/motion";
import { Card as RowsCard, CopyRow, ItemRow, NoteRow } from "./ListRows";
import { PhoneLinkIllustration } from "./PhoneLinkIllustration";

export function platformLabelKey(platform: string) {
  return platform === "ios" ? "settings.mobile.ios" : platform === "android" ? "settings.mobile.android" : "settings.mobile.phone";
}

export function newDeviceSince(before: readonly string[], after: readonly MobileDevice[]): MobileDevice | null {
  const known = new Set(before);
  return after.find((device) => !known.has(device.id)) ?? null;
}

const pill = "rounded-full bg-ink/5 px-2 py-0.5 text-[12px] leading-4 text-ink-secondary";
const primaryButton = "ui-button ui-button-primary mobile-press h-12 min-h-12 rounded-full bg-ink px-6 text-app enabled:hover:bg-ink/90 enabled:hover:text-app";

export function MobilePairingCard({ remote }: { remote: boolean }) {
  const [devices, setDevices] = useState<MobileDevice[] | null>(null);
  const [offer, setOffer] = useState<MobilePairingResponse | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyFeedback>("idle");
  const [showLink, setShowLink] = useState(false);
  const [pairedName, setPairedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0);
  const baseline = useRef<string[] | null>(null);
  const linkId = useId();
  const reducedMotion = useReducedMotion();

  const loadDevices = useCallback(async (epoch: number) => {
    try {
      const body = await api<{ devices: MobileDevice[]; current: string | null }>("/api/mobile/devices");
      if (generation.current !== epoch) return;
      setDevices(body.devices);
      if (baseline.current) {
        const added = newDeviceSince(baseline.current, body.devices);
        if (added) {
          baseline.current = null;
          setOffer(null);
          setPairedName(added.name);
          haptic("success");
        }
      }
    } catch (cause) {
      if (generation.current !== epoch) return;
      if (cause instanceof ApiError && cause.status === 403) {
        baseline.current = null;
        setOffer(null);
        setHidden(true);
      } else {
        setError(cause instanceof Error ? cause.message : t("settings.mobile.error"));
        haptic("error");
      }
    }
  }, []);

  useEffect(() => {
    const epoch = ++generation.current;
    baseline.current = null;
    setDevices(null);
    setOffer(null);
    setHidden(false);
    setBusy(false);
    setRemoving(null);
    setPairedName(null);
    setShowLink(false);
    setError(null);
    void loadDevices(epoch);
    return () => { generation.current += 1; };
  }, [loadDevices, remote]);

  useEffect(() => {
    if (!offer) return;
    const epoch = generation.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    const poll = async () => {
      await loadDevices(epoch);
      if (!cancelled) timer = setTimeout(() => void poll(), 2_000);
    };
    timer = setTimeout(() => void poll(), 2_000);
    return () => { cancelled = true; clearTimeout(timer); clearInterval(clock); };
  }, [loadDevices, offer]);

  async function create() {
    if (busy || !devices) return;
    const epoch = generation.current;
    setBusy(true);
    setError(null);
    setCopied("idle");
    setShowLink(false);
    setPairedName(null);
    setOffer(null);
    baseline.current = null;
    try {
      const request: MobilePairingRequest = {};
      const companion = remote ? null : companionBridge();
      if (companion) {
        try {
          request.companion = (await companion.start()).endpoints;
        } catch {}
      }
      if (generation.current !== epoch) return;
      const body = await api<MobilePairingResponse>("/api/mobile/pairing", { method: "POST", body: JSON.stringify(request) });
      if (generation.current !== epoch) return;
      baseline.current = devices.map((device) => device.id);
      setOffer(body);
      setNow(Date.now());
      haptic("success");
    } catch (cause) {
      if (generation.current === epoch) {
        setError(cause instanceof Error ? cause.message : t("settings.mobile.error"));
        haptic("error");
      }
    } finally {
      if (generation.current === epoch) setBusy(false);
    }
  }

  async function remove(id: string) {
    const epoch = generation.current;
    setRemoving(id);
    setError(null);
    try {
      await api(`/api/mobile/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (generation.current === epoch) await loadDevices(epoch);
    } catch (cause) {
      if (generation.current === epoch) {
        setError(cause instanceof Error ? cause.message : t("settings.mobile.error"));
        haptic("error");
      }
    } finally {
      if (generation.current === epoch) setRemoving(null);
    }
  }

  async function copyCode() {
    if (!offer?.code) return;
    const epoch = generation.current;
    const result = await copyText(offer.code);
    if (generation.current === epoch && result !== "empty") {
      setCopied(result);
      if (result === "failed") haptic("error");
    }
  }

  if (hidden) return null;
  const expired = offer !== null && offer.expiresAt <= now;
  const state = pairedName !== null ? "success" : offer ? "offer" : "idle";
  const groupedCode = offer?.code?.replace(/[^a-z0-9]/gi, "").match(/.{1,4}/g)?.join(" ");

  return (
    <div className="flex flex-col gap-5">
      <style>{`
        @keyframes phone-link-wait { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
        .phone-link-wait { animation: phone-link-wait 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .phone-link-wait { animation-play-state: paused; } }
        [data-reduced-motion="true"] .phone-link-wait { animation-play-state: paused; }
      `}</style>
      <RowsCard>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={state}
            initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
            transition={{ duration: reducedMotion ? 0 : dur.base, ease: ease.out }}
            className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6 px-4 py-7"
          >
            <PhoneLinkIllustration scanning={state === "offer" && !expired} />
            {pairedName !== null ? (
              <div className="flex min-w-0 flex-1 basis-[240px] flex-col items-start gap-4">
                <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-success/10 text-success"><Check size={24} /></span>
                <div role="status">
                  <h3 className="break-words text-[20px] font-semibold leading-7 text-ink">{t("mobile.desktop.linked", { name: pairedName })}</h3>
                  <p className="mt-2 text-[14px] leading-5 text-ink-secondary">{t("mobile.desktop.linkedHint")}</p>
                </div>
                <button type="button" onClick={() => void create()} disabled={busy || devices === null} className={primaryButton}>{t("mobile.desktop.linkAnother")}</button>
              </div>
            ) : offer ? (
              <div className="flex min-w-0 flex-1 basis-[256px] flex-col items-center gap-4">
                {expired ? (
                  <div className="flex min-h-[256px] flex-col items-center justify-center gap-4 text-center">
                    <p role="status" className="text-[16px] font-semibold text-ink">{t("settings.mobile.expired")}</p>
                    <button type="button" onClick={() => void create()} disabled={busy} className={primaryButton}>{t("settings.mobile.newCode")}</button>
                  </div>
                ) : (
                  <>
                    <div role="img" aria-label={t("settings.mobile.qr")} className="rounded-[16px] bg-white p-3">
                      <QRCodeSVG value={offer.link} size={232} level="M" includeMargin bgColor="#ffffff" fgColor="#000000" aria-hidden="true" />
                    </div>
                    <div role="status" className="flex flex-col items-center gap-1 text-center">
                      <p className="flex items-center gap-2 text-[14px] font-medium text-ink">
                        <span aria-hidden="true" className="phone-link-wait inline-block size-1.5 rounded-full bg-ink" />
                        {t("mobile.desktop.waiting")}
                      </p>
                      <p className="text-[12px] text-ink-tertiary">{t("settings.mobile.expires", { minutes: minutesLeft(offer.expiresAt, now) })}</p>
                    </div>
                    {offer.code !== null ? (
                      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                        <code aria-label={t("settings.mobile.code")} className="whitespace-nowrap font-mono text-[20px] tracking-[0.1em] text-ink select-all">{groupedCode}</code>
                        <button type="button" onClick={() => void copyCode()} className="ui-button mobile-press min-h-11 min-w-11 rounded-full" aria-live="polite">
                          {t(copied === "copied" ? "settings.mobile.copied" : copied === "failed" ? "settings.mobile.copyFailed" : "settings.mobile.copyCode")}
                        </button>
                      </div>
                    ) : <NoteRow>{t("settings.mobile.scanOnly")}</NoteRow>}
                    <button type="button" aria-expanded={showLink} aria-controls={linkId} onClick={() => { setShowLink(!showLink); haptic("selection"); }} className="mobile-press min-h-11 min-w-11 rounded-full px-3 text-[13px] text-ink-secondary hover:bg-ink/5">
                      {t("mobile.desktop.copyLinkInstead")}
                    </button>
                    <div id={linkId} hidden={!showLink} className="w-full [&_button]:min-h-11 [&_button]:min-w-11">
                      {showLink && <CopyRow title={t("settings.mobile.link")} text={offer.link} copyLabel={t("settings.mobile.copyLink")} />}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 basis-[240px] flex-col items-start gap-5">
                <div>
                  <h3 className="text-[22px] font-semibold leading-7 text-ink">{t("mobile.desktop.title")}</h3>
                  <p className="mt-2 text-[14px] leading-5 text-ink-secondary">{t("mobile.desktop.hint")}</p>
                </div>
                <button type="button" onClick={() => void create()} disabled={busy || devices === null} aria-busy={busy} className={primaryButton}>{t("settings.mobile.pair")}</button>
                <div className="flex flex-wrap gap-2">
                  {(["appStore", "googlePlay"] as const).map((store) => (
                    <span key={store} aria-label={t("mobile.desktop.storeComingSoon", { store: t(`mobile.desktop.${store}`) })} className="inline-flex items-center gap-2 rounded-full border border-hairline px-3 py-2">
                      <Smartphone size={16} aria-hidden="true" className="text-ink-secondary" />
                      <span className="flex flex-col">
                        <span className="text-[12px] font-medium leading-4 text-ink-secondary">{t(`mobile.desktop.${store}`)}</span>
                        <span className="text-[11px] leading-4 text-ink-tertiary">{t("mobile.desktop.comingSoon")}</span>
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        {error && <NoteRow tone="danger">{error}</NoteRow>}
      </RowsCard>
      <RowsCard label={t("settings.mobile.devices")}>
        {devices?.length ? devices.map((device) => (
          <ItemRow key={device.id} icon={Smartphone} title={device.name} hint={t("settings.mobile.seen", { when: lastSeen(device.lastSeenAt, now) })}>
            <span className={pill}>{t(platformLabelKey(device.platform))}</span>
            {device.relay && <span className={pill}>{t("settings.mobile.relay")}</span>}
            <button type="button" onClick={() => void remove(device.id)} disabled={removing !== null} aria-label={t("mobile.desktop.removePhone", { name: device.name })} className="ui-button mobile-press min-h-11 min-w-11 rounded-full">{t("settings.mobile.remove")}</button>
          </ItemRow>
        )) : <NoteRow>{t("settings.mobile.empty")}</NoteRow>}
      </RowsCard>
    </div>
  );
}
