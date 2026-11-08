import { useEffect, useId, useState } from "react";
import { QrCode } from "lucide-react";
import { t } from "@/lib/i18n";
import { WorkingDots } from "@/components/WorkingIndicator";
import { parseMobilePairingLink } from "../../../shared/mobile-link";
import { Sheet } from "../Sheet";
import { usePlatform } from "../platform";
import { haptic } from "../haptics";
import type { SheetPageProps } from "./registry";

export function LinkSheet({ open, onClose }: SheetPageProps<"link">) {
  const platform = usePlatform();
  const id = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<"invalid" | "scanError" | null>(null);
  const [scanning, setScanning] = useState(false);
  useEffect(() => { if (open) { setValue(""); setError(null); } }, [open]);
  const link = (input: string) => {
    const text = input.trim();
    if (!parseMobilePairingLink(text)) { setError("invalid"); haptic("error"); return; }
    window.dispatchEvent(new CustomEvent("omb:pair-link", { detail: text }));
    onClose();
  };
  const scan = async () => {
    if (!platform.scanQr || scanning) return;
    setScanning(true);
    setError(null);
    try { const result = await platform.scanQr(); if (result) link(result.text); }
    catch { setError("scanError"); haptic("error"); }
    finally { setScanning(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t("mobile.link.title")}>
      <div className="flex flex-col gap-5 px-6 pt-4">
        <p className="text-[16px] leading-6 text-ink-secondary">{t("mobile.link.computer")}<br />{t("mobile.link.steps")}</p>
        {platform.scanQr && <button type="button" disabled={scanning} aria-busy={scanning} onClick={() => void scan()} className="mobile-press flex h-12 items-center justify-center gap-2 rounded-full bg-ink text-[16px] font-semibold text-app disabled:opacity-40">{scanning ? <WorkingDots size={4} /> : <QrCode size={20} />}<span>{t("mobile.link.scan")}</span></button>}
        <form onSubmit={(event) => { event.preventDefault(); link(value); }} className="flex flex-col gap-3">
          <label htmlFor={id} className="text-[13px] text-ink-tertiary">{t("mobile.link.enter")}</label>
          <input id={id} name="pairLink" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={value} onChange={(event) => { setValue(event.target.value); setError(null); }} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} placeholder={t("mobile.link.enter")} className="h-12 min-w-0 rounded-full border-0 bg-ink/[0.05] px-4 text-[16px] text-ink placeholder:text-ink-tertiary" />
          <button type="submit" disabled={!value.trim() || scanning} className="mobile-press h-12 rounded-full bg-ink text-[16px] font-semibold text-app disabled:opacity-40">{t("mobile.link.submit")}</button>
        </form>
        {error && <p id={`${id}-error`} role="alert" className="text-[14px] text-danger">{t(`mobile.link.${error}`)}</p>}
      </div>
    </Sheet>
  );
}
