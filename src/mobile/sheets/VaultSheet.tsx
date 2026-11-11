import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, KeyRound, Plus } from "../../icons";
import { t } from "@/lib/i18n";
import { deleteLogin, listLogins } from "@/lib/logins";
import { api, useStore } from "@/state/store";
import type { LoginBots, LoginSummary } from "../../../shared/logins";
import type { SavedSecretSummary } from "../../../shared/saved-secrets";
import { Sheet } from "../Sheet";
import { haptic } from "../haptics";
import type { SheetPageProps } from "./registry";

type VaultEntry = { kind: "login"; value: LoginSummary } | { kind: "secret"; value: SavedSecretSummary };

export function VaultSheet({ open, onClose }: SheetPageProps<"vault">) {
  const { state, dispatch } = useStore();
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [selected, setSelected] = useState<VaultEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const deleting = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const [logins, secrets] = await Promise.all([listLogins(), api<{ secrets?: SavedSecretSummary[] }>("/api/saved-secrets")]);
      if (version === requestVersion.current) setEntries([...logins.logins.map((value): VaultEntry => ({ kind: "login", value })), ...(secrets.secrets ?? []).map((value): VaultEntry => ({ kind: "secret", value }))]);
    } catch { if (version === requestVersion.current) { setError(t("mobile.vault.loadError")); haptic("error"); } }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, []);
  useEffect(() => { if (open) { setSelected(null); setConfirming(false); void load(); } return () => { requestVersion.current++; }; }, [open, load]);
  useEffect(() => { if (!confirming) return; const timer = window.setTimeout(() => setConfirming(false), 3000); return () => window.clearTimeout(timer); }, [confirming]);
  const who = (bots: LoginBots) => {
    if (bots === "all") return t("mobile.vault.allBots");
    if (!bots.length) return t("mobile.vault.noBots");
    return t("mobile.vault.botAccess", { names: bots.map((id) => state.bots.find((bot) => bot.id === id)?.name ?? t("mobile.vault.unknownBot")).join(", ") });
  };
  const title = (entry: VaultEntry) => entry.kind === "login" ? entry.value.site : entry.value.label;
  const account = (entry: VaultEntry) => entry.kind === "login" ? entry.value.username || t("mobile.vault.noAccount") : t("mobile.vault.secret");
  const back = () => { setSelected(null); setConfirming(false); setError(null); };
  const remove = async () => {
    if (!selected || deleting.current || selected.kind === "login" && selected.value.source === "1password") return;
    if (!confirming) { setConfirming(true); return; }
    deleting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (selected.kind === "login") await deleteLogin(selected.value.id);
      else await api(`/api/saved-secrets/${encodeURIComponent(selected.value.id)}`, { method: "DELETE" });
      setEntries((current) => current.filter((entry) => !(entry.kind === selected.kind && entry.value.id === selected.value.id)));
      back();
    } catch { setError(t("mobile.vault.deleteError")); haptic("error"); }
    finally { deleting.current = false; setBusy(false); setConfirming(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} full title={selected ? title(selected) : t("mobile.vault.title")} back={selected ? back : undefined}>
      <div className="px-3 pt-2">
        {selected ? <div className="flex flex-col gap-5 px-3 pt-3">
          <KeyRound aria-hidden size={32} className="text-ink-secondary" />
          <div><h2 className="text-[13px] text-ink-tertiary">{t("mobile.vault.account")}</h2><p dir="auto" className="mt-1 break-words text-[16px] text-ink">{account(selected)}</p></div>
          <div><h2 className="text-[13px] text-ink-tertiary">{t("mobile.vault.access")}</h2><p className="mt-1 text-[14px] text-ink-secondary">{who(selected.value.bots)}</p></div>
          {selected.kind === "login" && selected.value.source === "1password" ? <p className="text-[14px] text-ink-secondary">{t("mobile.vault.readOnly")}</p> : <button type="button" disabled={busy} onClick={() => void remove()} className="mobile-press min-h-12 rounded-full bg-danger/10 px-5 text-[16px] font-semibold text-danger disabled:opacity-40">{confirming ? t("mobile.vault.confirmDelete") : t("mobile.vault.delete")}</button>}
        </div> : <>
          <button type="button" onClick={() => { dispatch({ type: "toggleAppSettings", open: true, section: "logins" }); onClose(); }} className="mobile-row flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 text-left text-[16px] font-semibold text-ink"><Plus aria-hidden size={22} />{t("mobile.vault.addLogin")}</button>
          {loading ? <div role="status" aria-label={t("mobile.vault.loading")}>{[0, 1, 2, 3].map((key) => <div key={key} aria-hidden className="flex items-center gap-3 px-3 py-4"><span className="size-10 rounded-full bg-ink/[0.05]" /><span className="flex-1 space-y-2"><span className="block h-4 w-2/3 rounded-full bg-ink/[0.05]" /><span className="block h-3 w-1/2 rounded-full bg-ink/[0.05]" /></span></div>)}</div> : !error && entries.length ? <ul>{entries.map((entry) => <li key={`${entry.kind}:${entry.value.id}`}><button type="button" onClick={() => { setSelected(entry); setConfirming(false); setError(null); }} className="mobile-row flex min-h-[84px] w-full items-center gap-3 rounded-2xl px-3 py-3 text-left"><KeyRound aria-hidden size={24} className="shrink-0 text-ink-secondary" /><span className="min-w-0 flex-1"><span dir="auto" className="block truncate text-[16px] font-semibold text-ink">{title(entry)}</span><span dir="auto" className="mt-0.5 block truncate text-[14px] text-ink-secondary">{account(entry)}</span><span className="block text-[14px] text-ink-secondary">{who(entry.value.bots)}</span></span><ChevronRight aria-hidden size={18} className="shrink-0 text-ink-tertiary" /></button></li>)}</ul> : !error ? <div className="px-6 py-16 text-center"><p className="text-[18px] font-semibold text-ink">{t("mobile.vault.empty")}</p><p className="mt-2 text-[14px] leading-6 text-ink-secondary">{t("mobile.vault.emptyHint")}</p></div> : null}
        </>}
        {error && <p role="alert" className="px-3 py-4 text-[14px] text-danger">{error}</p>}
        {!selected && error && <button type="button" onClick={() => void load()} disabled={loading} className="mobile-press mx-3 min-h-11 rounded-full bg-ink/[0.05] px-5 text-[14px] font-semibold text-ink">{t("mobile.vault.retry")}</button>}
      </div>
    </Sheet>
  );
}
