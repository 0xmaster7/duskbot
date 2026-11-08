import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import type { MobileDevice, MobilePairingRequest, MobilePairingResponse } from "../../shared/mobile-link";
import { companionBridge } from "@/lib/companion-bridge";
import { copyText, type CopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { api, ApiError } from "@/state/store";
import { lastSeen, minutesLeft } from "../lib/pairing-time";
import { Card as RowsCard, CopyRow, ItemRow, NoteRow } from "./ListRows";

export function platformLabelKey(platform: string) {
  return platform === "ios" ? "settings.mobile.ios" : platform === "android" ? "settings.mobile.android" : "settings.mobile.phone";
}

export function newDeviceSince(before: readonly string[], after: readonly MobileDevice[]): MobileDevice | null {
  const known = new Set(before);
  return after.find((device) => !known.has(device.id)) ?? null;
}

const pill = "rounded-full bg-ink/5 px-2 py-0.5 text-[12px] leading-4 text-ink-secondary";

export function MobilePairingCard({ remote }: { remote: boolean }) {
  const [devices, setDevices] = useState<MobileDevice[] | null>(null);
  const [offer, setOffer] = useState<MobilePairingResponse | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyFeedback>("idle");
  const [pairedName, setPairedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0);
  const baseline = useRef<string[] | null>(null);

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
    } catch (cause) {
      if (generation.current === epoch) setError(cause instanceof Error ? cause.message : t("settings.mobile.error"));
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
      if (generation.current === epoch) setError(cause instanceof Error ? cause.message : t("settings.mobile.error"));
    } finally {
      if (generation.current === epoch) setRemoving(null);
    }
  }

  async function copyCode() {
    if (!offer?.code) return;
    const epoch = generation.current;
    const result = await copyText(offer.code);
    if (generation.current === epoch && result !== "empty") setCopied(result);
  }

  if (hidden) return null;
  const expired = offer !== null && offer.expiresAt <= now;

  return (
    <div className="flex flex-col gap-5">
      <RowsCard>
        <ItemRow title={t("settings.mobile.title")} hint={t("settings.mobile.hint")}>
          <button type="button" onClick={() => void create()} disabled={busy || devices === null} className="ui-button ui-button-primary">
            {t("settings.mobile.pair")}
          </button>
        </ItemRow>
        {offer && (expired ? (
          <ItemRow title={t("settings.mobile.expired")}>
            <button type="button" onClick={() => void create()} disabled={busy} className="ui-button">{t("settings.mobile.newCode")}</button>
          </ItemRow>
        ) : (
          <>
            <div className="flex justify-center py-2">
              <div className="rounded-[10px] bg-white p-2" aria-label={t("settings.mobile.qr")}>
                <QRCodeSVG value={offer.link} size={176} level="M" includeMargin />
              </div>
            </div>
            {offer.code !== null ? (
              <ItemRow title={t("settings.mobile.code")}>
                <span className="font-mono text-[15px] tracking-[0.14em] text-ink">{offer.code}</span>
                <button type="button" onClick={() => void copyCode()} className="ui-button">
                  {t(copied === "copied" ? "settings.mobile.copied" : copied === "failed" ? "settings.mobile.copyFailed" : "settings.mobile.copyCode")}
                </button>
              </ItemRow>
            ) : <NoteRow>{t("settings.mobile.scanOnly")}</NoteRow>}
            <CopyRow title={t("settings.mobile.link")} text={offer.link} copyLabel={t("settings.mobile.copyLink")} />
            <NoteRow>{t("settings.mobile.expires", { minutes: minutesLeft(offer.expiresAt, now) })}</NoteRow>
          </>
        ))}
        {pairedName !== null && <NoteRow>{t("settings.mobile.paired", { name: pairedName })}</NoteRow>}
        {error && <NoteRow tone="danger">{error}</NoteRow>}
      </RowsCard>
      <RowsCard label={t("settings.mobile.devices")}>
        {devices?.length ? devices.map((device) => (
          <ItemRow key={device.id} title={device.name} hint={t("settings.mobile.seen", { when: lastSeen(device.lastSeenAt, now) })}>
            <span className={pill}>{t(platformLabelKey(device.platform))}</span>
            {device.relay && <span className={pill}>{t("settings.mobile.relay")}</span>}
            <button type="button" onClick={() => void remove(device.id)} disabled={removing !== null} className="ui-button">{t("settings.mobile.remove")}</button>
          </ItemRow>
        )) : <NoteRow>{t("settings.mobile.empty")}</NoteRow>}
      </RowsCard>
    </div>
  );
}
