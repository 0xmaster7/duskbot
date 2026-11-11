import { useEffect, useId, useRef, useState } from "react";
import { QrCode } from "../../icons";
import { t } from "@/lib/i18n";
import { WorkingDots } from "@/components/WorkingIndicator";
import { mobileLinkUrl } from "../../../shared/mobile-link";
import { Sheet } from "../Sheet";
import { usePlatform } from "../platform";
import { haptic } from "../haptics";
import { pairError, PairError, parseTypedPairing, resolveTypedCode } from "../connection/pair";
import type { SheetPageProps } from "./registry";

export function LinkSheet({ open, onClose }: SheetPageProps<"link">) {
  const platform = usePlatform();
  const id = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<PairError["code"] | "scanError" | null>(null);
  const [scanning, setScanning] = useState(false);
  const [resolving, setResolving] = useState(false);
  const generation = useRef(0);
  const locked = useRef(false);
  useEffect(() => {
    ++generation.current;
    locked.current = false;
    setResolving(false);
    setScanning(false);
    if (open) { setValue(""); setError(null); }
    return () => { ++generation.current; };
  }, [open]);
  const link = async (input: string) => {
    if (locked.current) return;
    locked.current = true;
    const current = generation.current;
    setResolving(true);
    setError(null);
    try {
      const parsed = parseTypedPairing(input);
      if (!parsed) throw new PairError("invalid");
      let text = input.trim();
      if ("kind" in parsed) {
        const payload = await resolveTypedCode(parsed.code);
        text = mobileLinkUrl({
          v: 2, workspace: { name: payload.name ?? "", environmentId: payload.environmentId ?? null, kind: payload.workspaceKind! },
          grant: { id: payload.grantId!, secret: payload.credential, expiresAt: payload.expiresAt! }, via: payload.via!,
        });
      }
      if (generation.current !== current) return;
      window.dispatchEvent(new CustomEvent("omb:pair-link", { detail: text }));
      onClose();
    } catch (failure) {
      if (generation.current !== current) return;
      setError(pairError(failure).code);
      haptic("error");
    } finally {
      if (generation.current === current) { locked.current = false; setResolving(false); }
    }
  };
  const scan = async () => {
    if (!platform.scanQr || scanning || locked.current) return;
    const current = generation.current;
    setScanning(true);
    setError(null);
    try { const result = await platform.scanQr(); if (result && current === generation.current) await link(result.text); }
    catch { if (current === generation.current) { setError("scanError"); haptic("error"); } }
    finally { if (current === generation.current) setScanning(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t("mobile.link.title")}>
      <div className="flex flex-col gap-5 px-6 pt-4">
        <p className="text-[16px] leading-6 text-ink-secondary">{t("mobile.link.computer")}<br />{t("mobile.link.steps")}</p>
        {platform.scanQr && <button type="button" disabled={scanning || resolving} aria-busy={scanning || resolving} onClick={() => void scan()} className="mobile-press flex h-12 items-center justify-center gap-2 rounded-full bg-ink text-[16px] font-semibold text-app disabled:opacity-40">{scanning ? <WorkingDots size={4} /> : <QrCode size={20} />}<span>{t("mobile.link.scan")}</span></button>}
        <form onSubmit={(event) => { event.preventDefault(); void link(value); }} className="flex flex-col gap-3">
          <label htmlFor={id} className="text-[13px] text-ink-tertiary">{t("mobile.pair.linkOrCode")}</label>
          <input id={id} name="pairLink" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} value={value} onChange={(event) => { setValue(event.target.value); setError(null); }} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} placeholder={t("mobile.pair.linkOrCode")} className="h-12 min-w-0 rounded-full border-0 bg-ink/[0.05] px-4 text-[16px] text-ink placeholder:text-ink-tertiary" />
          <button type="submit" disabled={!value.trim() || scanning || resolving} aria-busy={resolving} className="mobile-press h-12 rounded-full bg-ink text-[16px] font-semibold text-app disabled:opacity-40">{t("mobile.link.submit")}</button>
        </form>
        {error && <p id={`${id}-error`} role="alert" className="text-[14px] text-danger">{error === "scanError" ? t("mobile.link.scanError") : t(`mobile.pair.${error}`)}</p>}
      </div>
    </Sheet>
  );
}
