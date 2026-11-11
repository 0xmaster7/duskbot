import { useContext, useId, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bell, CalendarClock, Check, FileText, Globe, KeyRound, LayoutDashboard, LifeBuoy, LogOut, MoreHorizontal, Palette, Plug, Plus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { accountDashboardUrl } from "@/lib/account-dashboard";
import { useGroupYou } from "@/components/GroupAvatar";
import { t } from "@/lib/i18n";
import { effectiveLanguage, setLanguageChoice, useLanguageChoice, usePageLanguage } from "@/lib/language-preference";
import { applySkinChoice, readSkinChoice, subscribeSkin, THEME_SKINS } from "@/lib/skins";
import { localeChoices } from "@/locales";
import { useStore } from "@/state/store";
import type { MobileConnectionRecord } from "../../../shared/mobile-link";
import { useLongPress } from "../ContextMenu";
import { useConnections } from "../connection/connections";
import { haptic, setHapticsEnabled, useHapticsEnabled } from "../haptics";
import { dur, ease, spring } from "../motion";
import { useMobileAccount } from "../account/AccountGate";
import { DEMO_CONNECTION, leaveDemo } from "../demo/demo-mode";
import { ActiveConnection } from "../connection/active";
import { LEGAL_LINKS } from "../legal";
import { usePlatform } from "../platform";
import { Sheet } from "../Sheet";
import { SettingsRow, SettingsSection, SettingsSwitch } from "./SettingsRow";
import type { SheetPageProps } from "./registry";

/** The account rows Settings shows. The account dashboard sells plans, so the store apps never link to it (App Store
 * guideline 3.1.1, Play payments policy); a signed-in account can always be signed out and deleted from here. */
export function accountRows(input: { native: boolean; demo: boolean; signedIn: boolean }): { dashboard: boolean; signOut: boolean; deleteAccount: boolean } {
  return { dashboard: !input.native && !input.demo, signOut: input.signedIn, deleteAccount: input.signedIn };
}

export const SettingsSheet: ComponentType<SheetPageProps<"settings">> = ({ sheet, open, onClose, onOpenSheet }) => {
  const { state } = useStore();
  const { connections, activeId, switchTo, remove } = useConnections();
  const demo = useContext(ActiveConnection) === DEMO_CONNECTION;
  const you = useGroupYou();
  const platform = usePlatform();
  const account = useMobileAccount();
  const hapticsEnabled = useHapticsEnabled();
  const skin = useSyncExternalStore(subscribeSkin, readSkinChoice, () => "system");
  const language = effectiveLanguage(useLanguageChoice(), state.config?.language);
  usePageLanguage(language);
  const [page, setPage] = useState<"main" | "language" | "delete">(sheet.page === "language" ? "language" : "main");
  const [unlinkId, setUnlinkId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const appearanceId = useId();
  const active = connections.find((connection) => connection.id === activeId);
  const workspace = demo ? t("mobile.settings.demoName") : active?.label ?? globalThis.location?.host ?? "";
  const email = account?.account?.email;
  const rows = accountRows({ native: platform.native, demo, signedIn: Boolean(email) });

  const changeWorkspace = async (id: string, unlink = false) => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      if (unlink) await remove(id);
      else { haptic("selection"); await switchTo(id); }
      setUnlinkId(null);
    } catch {
      haptic("error");
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t(page === "language" ? "mobile.settings.language" : page === "delete" ? "mobile.settings.deleteAccount" : "mobile.settings.title")} full back={page !== "main" ? () => setPage("main") : undefined}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={page} initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -4, opacity: 0 }} transition={{ duration: dur.base, ease: ease.out }} className="px-2 pb-6">
          {page === "language" ? (
            <SettingsSection>
              {[{ code: "", label: t("mobile.settings.system") }, ...localeChoices].map(({ code, label }) => (
                <button key={code} type="button" aria-pressed={language === code} onClick={() => { haptic("selection"); setLanguageChoice(code); }} className="mobile-row flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-[16px] font-semibold text-ink">
                  <span className="min-w-0 flex-1">{label}</span>
                  {language === code && <Check aria-hidden size={20} />}
                </button>
              ))}
            </SettingsSection>
          ) : page === "delete" ? (
            <div className="px-4 pt-2">
              <h2 className="text-[20px] font-semibold text-ink">{t("mobile.settings.deleteTitle")}</h2>
              <p className="mt-2 text-[15px] leading-6 text-ink-secondary">{t("mobile.settings.deleteBody", { email: email ?? "" })}</p>
              <div className="mt-6 flex flex-col gap-2">
                <button type="button" onClick={() => { void platform.openExternal(`${account?.origin ?? ""}${LEGAL_LINKS.deleteAccountPath}`); }} className="mobile-press flex min-h-12 items-center justify-center rounded-full bg-danger px-5 text-[16px] font-semibold text-[var(--color-danger-ink)]">{t("mobile.settings.deleteContinue")}</button>
                <button type="button" onClick={() => setPage("main")} className="mobile-press flex min-h-12 items-center justify-center rounded-full bg-ink/[0.05] px-5 text-[16px] font-semibold text-ink">{t("mobile.settings.cancel")}</button>
              </div>
            </div>
          ) : <>
            <div className="flex items-center gap-3.5 px-4 py-5">
              <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink/[0.05] text-[20px] font-semibold text-ink">
                {you?.avatarUrl ? <img src={you.avatarUrl} alt="" className="size-full object-cover" /> : you?.initials ?? <UserRound aria-hidden size={24} />}
              </span>
              <div className="min-w-0"><p className="text-[20px] font-semibold text-ink">{state.config?.profile?.name || t("mobile.settings.you")}</p><p className="truncate text-[14px] text-ink-secondary">{workspace}</p></div>
            </div>
            <SettingsSection>
              <SettingsRow icon={<Bell />} label={t("mobile.settings.notifications")} value={state.notifications.filter((entry) => !entry.read).length} onClick={() => onOpenSheet({ kind: "notifications" })} />
            </SettingsSection>
            <SettingsSection title={t("mobile.settings.workspaces")}>
              {connections.map((connection) => (
                <WorkspaceRow key={connection.id} connection={connection} active={connection.id === activeId} confirming={unlinkId === connection.id} busy={busy} onSelect={() => { void changeWorkspace(connection.id); }} onConfirm={() => { setError(false); setUnlinkId(connection.id); }} onCancel={() => { setUnlinkId(null); setError(false); }} onUnlink={() => { void changeWorkspace(connection.id, true); }} />
              ))}
              {error && <p role="alert" className="px-4 py-2 text-[14px] text-danger">{t("mobile.settings.workspaceError")}</p>}
              {demo && <SettingsRow icon={<LogOut />} label={t("mobile.settings.leaveDemo")} detail={t("mobile.settings.leaveDemoDetail")} onClick={() => { void leaveDemo(platform); }} />}
              <SettingsRow icon={<Plus />} label={t("mobile.settings.link")} onClick={() => { onClose(); window.dispatchEvent(new Event("omb:link-another")); }} />
            </SettingsSection>
            <SettingsSection title={t("mobile.settings.bots")}>
              <SettingsRow icon={<CalendarClock />} label={t("mobile.settings.routines")} onClick={() => onOpenSheet({ kind: "routines" })} />
              {!demo && <SettingsRow icon={<Plug />} label={t("mobile.settings.connectors")} onClick={() => onOpenSheet({ kind: "connectors" })} />}
              {!demo && <SettingsRow icon={<KeyRound />} label={t("mobile.settings.vault")} onClick={() => onOpenSheet({ kind: "vault" })} />}
            </SettingsSection>
            <SettingsSection title={t("mobile.settings.phone")}>
              <SettingsSwitch label={t("mobile.settings.haptics")} checked={hapticsEnabled} onChange={(enabled) => { if (!enabled) haptic("selection"); setHapticsEnabled(enabled); if (enabled) haptic("selection"); }} />
              <SettingsRow icon={<Palette />} label={t("mobile.settings.appearance")} />
              <div role="group" aria-label={t("mobile.settings.appearance")} className="mx-4 mb-2 flex rounded-full bg-ink/[0.05] p-1">
                {([{ choice: "system", label: t("mobile.settings.system") }, { choice: THEME_SKINS.light, label: t("mobile.settings.light") }, { choice: THEME_SKINS.dark, label: t("mobile.settings.dark") }] as const).map(({ choice, label }) => (
                  <button key={choice} type="button" aria-pressed={skin === choice} onClick={() => { haptic("selection"); applySkinChoice(choice); }} className="mobile-press relative flex min-h-11 flex-1 items-center justify-center rounded-full px-2 text-[14px] font-semibold text-ink">
                    {skin === choice && <motion.span aria-hidden layoutId={`${appearanceId}-selection`} className="absolute inset-0 rounded-full bg-composer mobile-float" transition={spring.settle} />}
                    <span className="relative">{label}</span>
                  </button>
                ))}
              </div>
              <SettingsRow icon={<Globe />} label={t("mobile.settings.language")} value={localeChoices.find((choice) => choice.code === language)?.label ?? t("mobile.settings.system")} onClick={() => setPage("language")} />
            </SettingsSection>
            {(rows.dashboard || rows.signOut) && (
              <SettingsSection title={t("mobile.settings.account")}>
                {rows.dashboard && <SettingsRow icon={<LayoutDashboard />} label={t("mobile.settings.accountDashboard")} onClick={() => void accountDashboardUrl().then((url) => platform.openExternal(url))} />}
                {rows.signOut && <SettingsRow icon={<LogOut />} label={t("accountGate.signOut")} detail={email} onClick={() => void account?.signOut()} />}
                {rows.deleteAccount && <SettingsRow icon={<Trash2 />} label={t("mobile.settings.deleteAccount")} danger onClick={() => setPage("delete")} />}
              </SettingsSection>
            )}
            <SettingsSection title={t("mobile.settings.about")}>
              <SettingsRow icon={<ShieldCheck />} label={t("mobile.settings.privacy")} onClick={() => void platform.openExternal(LEGAL_LINKS.privacy)} />
              <SettingsRow icon={<FileText />} label={t("mobile.settings.terms")} onClick={() => void platform.openExternal(LEGAL_LINKS.terms)} />
              <SettingsRow icon={<LifeBuoy />} label={t("mobile.settings.help")} onClick={() => void platform.openExternal(LEGAL_LINKS.help)} />
            </SettingsSection>
            <p className="mt-8 text-center text-[13px] text-ink-tertiary">{t("mobile.settings.version", { version: platform.appVersion })}</p>
          </>}
        </motion.div>
      </AnimatePresence>
    </Sheet>
  );
};

function WorkspaceRow({ connection, active, confirming, busy, onSelect, onConfirm, onCancel, onUnlink }: {
  connection: MobileConnectionRecord;
  active: boolean;
  confirming: boolean;
  busy: boolean;
  onSelect: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onUnlink: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useLongPress(ref, onConfirm, !confirming && !busy);
  if (confirming) return (
    <div className="px-4 py-2" aria-busy={busy}>
      <p className="text-[16px] font-semibold text-ink">{t("mobile.settings.unlinkQuestion", { name: connection.label })}</p>
      <div className="mt-1 flex gap-2">
        <button autoFocus type="button" disabled={busy} onClick={onCancel} className="mobile-press min-h-11 rounded-full bg-ink/[0.05] px-5 text-[14px] font-semibold text-ink disabled:opacity-40">{t("mobile.settings.cancel")}</button>
        <button type="button" disabled={busy} onClick={onUnlink} className="mobile-press min-h-11 rounded-full px-5 text-[14px] font-semibold text-danger disabled:opacity-40">{t("mobile.settings.unlink")}</button>
      </div>
    </div>
  );
  return (
    <div className="flex items-center pr-2">
      <button ref={ref} type="button" disabled={busy} aria-current={active ? "true" : undefined} onClick={active ? undefined : onSelect} className="mobile-row flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl px-4 py-2.5 text-left text-ink disabled:opacity-40">
        <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{connection.label}</span>
        {active && <Check size={20} aria-label={t("mobile.settings.active")} />}
      </button>
      <button type="button" disabled={busy} aria-label={t("mobile.settings.workspaceActions", { name: connection.label })} onClick={onConfirm} className="mobile-press flex size-11 shrink-0 items-center justify-center rounded-full text-ink-secondary disabled:opacity-40"><MoreHorizontal aria-hidden size={20} /></button>
    </div>
  );
}
