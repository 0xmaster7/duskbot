import { useEffect, useRef, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { t } from "@/lib/i18n";
import { Card, ItemRow, NoteRow, SwitchRow } from "./ListRows";
import { SettingsSelect } from "./SettingsSelect";

type VpsPolicy = Pick<ConfigStatus["vps"], "mode" | "autoStart" | "idleTimeoutMinutes" | "independentScreens" | "maxScreens">;

export function VpsComputerSettings() {
  const { state } = useStore();
  const vps = state.config?.vps;
  if (!vps?.configured) return null;
  return <VpsSettings key={`${window.location?.origin ?? ""}:${vps.sshAlias}`} />;
}

function VpsSettings() {
  const { state, dispatch } = useStore();
  const owner = useOwnerOrAdmin();
  const vps = state.config!.vps;
  const [draft, setDraft] = useState<VpsPolicy | null>(null);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const disabled = owner !== true || !state.connected || draft !== null;
  const mode = draft?.mode ?? vps.mode ?? "shared";
  const autoStart = draft?.autoStart ?? vps.autoStart ?? true;
  const idle = draft?.idleTimeoutMinutes ?? vps.idleTimeoutMinutes ?? 10;
  const independentScreens = draft?.independentScreens ?? vps.independentScreens ?? true;
  const maxScreens = draft?.maxScreens ?? vps.maxScreens ?? 20;
  const serverPage = window.ogb?.remoteClient?.active === true || window.ogb?.app?.ownPage === false;
  const working = serverPage && state.connected;
  const save = async (patch: VpsPolicy) => {
    if (disabled || saving.current) return;
    saving.current = true;
    setDraft(patch);
    setError("");
    try {
      const config = await api<ConfigStatus>("/api/config", { method: "PATCH", body: JSON.stringify({ vps: patch }) });
      if (mounted.current) dispatch({ type: "configStatus", config });
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : t("settings.vps.saveFailed"));
    } finally {
      saving.current = false;
      if (mounted.current) setDraft(null);
    }
  };
  return <Card label={t("settings.w6a.vps.title")} data-settings-block="vps">
    <ItemRow title={t("settings.vps.connection")} hint={vps.sshAlias}>
      <span data-vps-connection={working ? "working" : serverPage ? "reconnecting" : "configured"} className={working ? "text-[13px] text-success" : "text-[13px] text-ink-secondary"}>
        {working ? t("settings.vps.working") : serverPage ? t("browser.panel.reconnecting") : t("settings.vps.configured")}
      </span>
    </ItemRow>
    {vps.mode !== undefined && <>
      <ItemRow title={t("settings.vps.sharing")} hint={vps.sharingAllowed === false ? t("settings.vps.privacyHint") : mode === "shared" ? t("settings.vps.sharedHint") : t("settings.vps.privateHint")}>
        {vps.sharingAllowed === false ? <span className="text-[13px] text-ink-secondary">{t("settings.vps.perBot")}</span> : <SettingsSelect aria-label={t("settings.vps.sharing")} value={mode} disabled={disabled} onChange={(event) => void save({ mode: event.target.value as "shared" | "per-bot" })} options={[
          { value: "shared", label: t("settings.vps.shared") }, { value: "per-bot", label: t("settings.vps.perBot") },
        ]} />}
      </ItemRow>
      <SwitchRow title={t("settings.vps.autoStart")} hint={t("settings.vps.autoStartHint")} checked={autoStart} disabled={disabled} onChange={() => void save({ autoStart: !autoStart })} />
      <ItemRow title={t("settings.vps.idle")} hint={t("settings.vps.idleHint")}>
        <SettingsSelect aria-label={t("settings.vps.idle")} value={String(idle)} disabled={disabled} onChange={(event) => void save({ idleTimeoutMinutes: Number(event.target.value) as 0 | 5 | 10 | 30 })} options={[0, 5, 10, 30].map((minutes) => ({ value: String(minutes), label: minutes ? t("settings.vps.minutes", { minutes }) : t("settings.vps.off") }))} />
      </ItemRow>
      {mode === "shared" && vps.sharingAllowed !== false && <details className="px-1">
        <summary className="cursor-pointer px-2 py-2 text-[13px] text-ink-secondary">{t("settings.simple.advanced")}</summary>
        <SwitchRow title={t("settings.vps.independentScreens")} hint={t("settings.vps.independentScreensHint")} checked={independentScreens} disabled={disabled} onChange={() => void save({ independentScreens: !independentScreens })} />
        {independentScreens && <ItemRow title={t("settings.vps.maxScreens")} hint={t("settings.vps.maxScreensHint")}>
          <SettingsSelect aria-label={t("settings.vps.maxScreens")} value={String(maxScreens)} disabled={disabled} onChange={(event) => void save({ maxScreens: Number(event.target.value) })} options={[...new Set([4, 10, 15, 20, maxScreens])].sort((left, right) => left - right).map((count) => ({ value: String(count), label: String(count) }))} />
        </ItemRow>}
      </details>}
    </>}
    {owner === false && <NoteRow>{t("settings.adminOnly.change")}</NoteRow>}
    {error && <NoteRow tone="danger">{error}</NoteRow>}
  </Card>;
}
