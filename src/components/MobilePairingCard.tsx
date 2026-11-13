import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, KeyRound, QrCode } from "../icons";
import { QRCodeSVG } from "qrcode.react";

import type { MobileDevice, MobilePairingRequest, MobilePairingResponse } from "../../shared/mobile-link";
import { companionBridge } from "@/lib/companion-bridge";
import { copyText, type CopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { requireUserPresence } from "@/lib/user-presence";
import { api, ApiError } from "@/state/store";
import { lastSeen, minutesLeft } from "../lib/pairing-time";
import { haptic } from "../mobile/haptics";
import { dur, ease } from "../mobile/motion";
import { Card as RowsCard, CopyRow, ItemRow, NoteRow } from "./ListRows";
import { PhoneHomeShot, StoreMarks } from "./PhoneHomeShot";
import { PlaceArt } from "./ui/PlaceArt";

export function platformLabelKey(platform: string) {
  return platform === "ios" ? "settings.mobile.ios" : platform === "android" ? "settings.mobile.android" : "settings.mobile.phone";
}

export function newDeviceSince(before: readonly string[], after: readonly MobileDevice[]): MobileDevice | null {
  const known = new Set(before);
  return after.find((device) => !known.has(device.id)) ?? null;
}

const pill = "rounded-full bg-ink/5 px-2 py-0.5 text-[12px] leading-4 text-ink-secondary";
const tileButton = "ui-button mobile-press mt-auto min-h-11 rounded-full";
const quietButton = "mobile-press min-h-11 rounded-full px-3 text-[13px] font-medium text-ink-secondary hover:bg-ink/5 disabled:opacity-50";

/** The phone page's pieces, for a caller that lays them out around its own pairing code. */
export interface PhoneParts { hero: ReactNode; qrTile: ReactNode; codeTile: ReactNode; phones: ReactNode }

type Way = "qr" | "code";

export function MobilePairingCard({ remote, accountEmail = null, children }: {
  remote: boolean; accountEmail?: string | null;
  /** lays the pieces out; null when this workspace may not link phones */
  children?: (phone: PhoneParts | null) => ReactNode;
}) {
  const [devices, setDevices] = useState<MobileDevice[] | null>(null);
  const [offer, setOffer] = useState<MobilePairingResponse | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [showLink, setShowLink] = useState(false);
  const [shown, setShown] = useState<Record<Way, boolean>>({ qr: false, code: false });
  const [errorWay, setErrorWay] = useState<Way>("qr");
  const [copied, setCopied] = useState<CopyFeedback>("idle");
  const [pairedName, setPairedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0);
  const baseline = useRef<string[] | null>(null);
  const linkId = useId();
  const tileId = useId();
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
    setShown({ qr: false, code: false });
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

  async function create(way: Way) {
    if (busy || !devices) return;
    setErrorWay(way);
    // the other tile's live offer already carries what this one shows
    if (offer && offer.expiresAt > Date.now() && pairedName === null && !shown[way]) {
      setShown({ ...shown, [way]: true });
      return;
    }
    setShown({ qr: way === "qr", code: way === "code" });
    setCopied("idle");
    const epoch = generation.current;
    setBusy(true);
    setError(null);
    setShowLink(false);
    setPairedName(null);
    setOffer(null);
    baseline.current = null;
    try {
      if (!(await requireUserPresence()) || generation.current !== epoch) return;
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

  if (hidden) return children ? <>{children(null)}</> : null;
  const expired = offer !== null && offer.expiresAt <= now;
  const state = pairedName !== null ? "success" : offer ? (expired ? "expired" : "offer") : "idle";
  const groupedCode = offer?.code?.replace(/[^a-z0-9]/gi, "").match(/.{1,4}/g)?.join(" ");

  const hero = (
    <div data-phone-hero="" className="flex items-center gap-6 px-3">
      <PhoneHomeShot />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
        <div>
          <h3 className="text-[22px] font-semibold leading-7 tracking-[-0.02em] text-ink">{t("mobile.desktop.title")}</h3>
          <p className="mt-1.5 text-[14px] font-medium leading-5 text-ink-secondary">{t("mobile.desktop.useCase")}</p>
        </div>
        <p data-phone-platforms="" className="m-0 flex items-center gap-2 text-[13px] leading-[18px] text-ink-secondary"><StoreMarks />{t("mobile.desktop.platforms")}</p>
        <p data-phone-web-app="" className="m-0 text-[13px] leading-[18px] text-ink-tertiary">{t("mobile.desktop.noStoreApp")}</p>
        {accountEmail && <p data-phone-sign-in="" className="m-0 text-[13px] leading-[18px] text-ink-tertiary">{t("settings.docs.phone.signInSteps", { email: accountEmail })}</p>}
      </div>
    </div>
  );

  // both ways read the same short-lived offer: the qr carries its link, the code tile its typed code
  const wayTile = (way: Way) => {
    const at = !shown[way] ? "idle" : state;
    const qr = way === "qr";
    return (
      <PairingTile id={`${tileId}-${way}`} icon={qr ? <QrCode size={16} /> : <KeyRound size={16} />} title={t(qr ? "settings.mobile.scanTitle" : "settings.w6.pairing.title")} data-pairing-tile={way}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={at}
            initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
            transition={{ duration: reducedMotion ? 0 : dur.base, ease: ease.out }}
            className="flex flex-1 flex-col items-start gap-3"
          >
            {at === "success" ? (
              <>
                <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-success/10 text-success"><Check size={20} /></span>
                <div role="status">
                  <p className="m-0 break-words text-[14px] font-medium leading-5 text-ink">{t("mobile.desktop.linked", { name: pairedName ?? "" })}</p>
                  <p className="m-0 mt-1 text-[13px] leading-[18px] text-ink-secondary">{t("mobile.desktop.linkedHint")}</p>
                </div>
                <button type="button" onClick={() => void create(way)} disabled={busy || devices === null} className={tileButton}>{t("mobile.desktop.linkAnother")}</button>
              </>
            ) : at === "expired" ? (
              <>
                <p role="status" className="m-0 text-[13px] leading-[18px] text-ink-secondary">{t("settings.mobile.expired")}</p>
                <button type="button" onClick={() => void create(way)} disabled={busy} className={tileButton}>{t("settings.mobile.newCode")}</button>
              </>
            ) : at === "offer" && offer ? (
              <div data-phone-offer={way} className="flex w-full flex-col items-start gap-3">
                {qr ? (
                  <div role="img" aria-label={t("settings.mobile.qr")} className="rounded-[12px] bg-white p-2">
                    <QRCodeSVG value={offer.link} size={148} level="M" includeMargin={false} bgColor="#ffffff" fgColor="#1b1b1f" aria-hidden="true" />
                  </div>
                ) : offer.code !== null ? (
                  <>
                    <p className="m-0 text-[13px] leading-[18px] text-ink-secondary">{t("settings.docs.phone.codeSteps")}</p>
                    <code aria-label={t("settings.mobile.code")} className="select-all whitespace-nowrap font-mono text-[22px] leading-8 tracking-[0.1em] text-ink">{groupedCode}</code>
                  </>
                ) : <p className="m-0 text-[13px] leading-[18px] text-ink-secondary">{t("settings.mobile.scanOnly")}</p>}
                <p role="status" className="m-0 flex flex-wrap items-center gap-x-2 text-[13px] font-medium leading-[18px] text-ink">
                  <span aria-hidden="true" className="phone-link-wait inline-block size-1.5 rounded-full bg-ink" />
                  {t("mobile.desktop.waiting")}
                  <span className="font-normal text-ink-tertiary">· {t("settings.mobile.expires", { minutes: minutesLeft(offer.expiresAt, now) })}</span>
                </p>
                <div className="-ms-3 mt-auto flex flex-wrap items-center">
                  <button type="button" data-phone-new-code="" onClick={() => void create(way)} disabled={busy} className={quietButton}>{t("settings.mobile.newCode")}</button>
                  {qr ? (
                    <button type="button" aria-expanded={showLink} aria-controls={linkId} onClick={() => { setShowLink(!showLink); haptic("selection"); }} className={quietButton}>
                      {t("mobile.desktop.copyLinkInstead")}
                    </button>
                  ) : offer.code !== null ? (
                    <button type="button" onClick={() => void copyCode()} className={quietButton} aria-live="polite">
                      {t(copied === "copied" ? "settings.mobile.copied" : copied === "failed" ? "settings.mobile.copyFailed" : "settings.mobile.copyCode")}
                    </button>
                  ) : null}
                </div>
                {qr && (
                  <div id={linkId} hidden={!showLink} className="-mx-2 w-[calc(100%+1rem)] [&_button]:min-h-11 [&_button]:min-w-11">
                    {showLink && <CopyRow title={t("settings.mobile.link")} text={offer.link} copyLabel={t("settings.mobile.copyLink")} />}
                  </div>
                )}
              </div>
            ) : (
              <>
                <p className="m-0 text-[13px] leading-[18px] text-ink-secondary">{t(qr ? "settings.mobile.scanHint" : "settings.docs.phone.enterCodeHint")}</p>
                <button type="button" {...(qr ? { "data-phone-pair": "" } : { "data-phone-code": "" })} onClick={() => void create(way)} disabled={busy || devices === null} className={tileButton}>
                  {t(qr ? "settings.mobile.showQr" : "settings.simple.computer.createCode")}
                </button>
              </>
            )}
          </motion.div>
        </AnimatePresence>
        {error && errorWay === way && <p role="alert" className="m-0 text-[13px] leading-[18px] text-danger">{error}</p>}
      </PairingTile>
    );
  };

  const phones = (
    <RowsCard label={t("settings.mobile.devices")}>
      {devices?.length ? devices.map((device) => (
        <ItemRow key={device.id} pixel={<PlaceArt name="phone" size={24} />} title={device.name} hint={t("settings.mobile.seen", { when: lastSeen(device.lastSeenAt, now) })}>
          <span className={pill}>{t(platformLabelKey(device.platform))}</span>
          {device.relay && <span className={pill}>{t("settings.mobile.relay")}</span>}
          <button type="button" onClick={() => void remove(device.id)} disabled={removing !== null} aria-label={t("mobile.desktop.removePhone", { name: device.name })} className="ui-button mobile-press min-h-11 min-w-11 rounded-full">{t("settings.mobile.remove")}</button>
        </ItemRow>
      )) : <NoteRow>{t("settings.mobile.empty")}</NoteRow>}
    </RowsCard>
  );

  const parts: PhoneParts = { hero, qrTile: wayTile("qr"), codeTile: wayTile("code"), phones };
  return (
    <>
      <style>{`
        @keyframes phone-link-wait { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
        .phone-link-wait { animation: phone-link-wait 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .phone-link-wait { animation-play-state: paused; } }
        [data-reduced-motion="true"] .phone-link-wait { animation-play-state: paused; }
      `}</style>
      {children ? children(parts) : <div className="flex flex-col gap-5">{hero}{parts.qrTile}{parts.codeTile}{phones}</div>}
    </>
  );
}

/** One way to pair: its own tile with a small glyph, a lowercase name, and what it does. */
export function PairingTile({ id, icon, title, children, ...rest }: { id: string; icon: ReactNode; title: string; children: ReactNode; "data-pairing-tile"?: string }) {
  return (
    <section {...rest} aria-labelledby={id} className="flex min-w-0 flex-col gap-3 rounded-[12px] border-[0.5px] border-edge bg-composer p-4">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink/5 text-ink">{icon}</span>
        <h4 id={id} className="m-0 min-w-0 truncate text-[14px] font-medium leading-5 text-ink">{title}</h4>
      </div>
      {children}
    </section>
  );
}
