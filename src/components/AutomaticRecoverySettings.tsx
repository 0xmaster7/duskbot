import { useRef, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import { SettingsGroup, SettingsRows, Switch } from "./SettingsPrimitives";
import { Select } from "./Select";

type Recovery = NonNullable<ConfigStatus["automaticRecovery"]>;

export function AutomaticRecoverySettings() {
  const { state, dispatch } = useStore();
  const [draft, setDraft] = useState<Recovery | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const value = draft ?? state.config?.automaticRecovery ?? { enabled: false };
  const engines = state.instances.filter((instance) => instance.snapshot.state === "available" && !instance.policy);
  const engine = engines.find((instance) => instance.instanceId === value.backup?.instanceId);
  const models = engine?.models.options.filter((model) => !model.orgBlocked && (engine.snapshot.authenticated !== false || model.custom)) ?? [];
  const ready = models.some((model) => model.id === value.backup?.model);
  const change = (next: Recovery) => { setDraft(next); setError(""); };
  const save = async () => {
    if (!draft || inFlight.current || (value.enabled && !ready)) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const config = await api<ConfigStatus>("/api/config", {
        method: "PUT",
        body: JSON.stringify({ automaticRecovery: { enabled: draft.enabled, ...(draft.backup?.model ? { backup: draft.backup } : {}) } }),
      });
      dispatch({ type: "configStatus", config });
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.recovery.error"));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  const row = "flex min-h-12 flex-wrap items-center justify-between gap-x-5 gap-y-2 px-3.5 py-2.5";
  const label = "text-[13px] leading-[18px] tracking-[-0.08px] text-ink";
  return (
    <SettingsGroup label={t("settings.recovery.title")} block="recovery">
      <SettingsRows>
        <div className={row}>
          <div className="min-w-0 flex-1 basis-48">
            <label htmlFor="automatic-recovery-enabled" className={label}>{t("settings.recovery.enable")}</label>
            {value.enabled && <div className="text-[13px] leading-[18px] tracking-[-0.08px] text-ink-secondary">{t(ready ? "settings.w6c.recovery.charges" : "settings.recovery.required")}</div>}
          </div>
          <Switch id="automatic-recovery-enabled" checked={value.enabled} disabled={saving || !state.config}
            onClick={() => change({ ...value, enabled: !value.enabled })} />
        </div>
        <div className={row}>
          <label htmlFor="automatic-recovery-engine" className={label}>{t("settings.recovery.engine")}</label>
          <Select size="sm" id="automatic-recovery-engine" value={value.backup?.instanceId ?? ""} disabled={saving || !value.enabled}
            onChange={(event) => change({ enabled: value.enabled, ...(event.target.value ? { backup: { instanceId: event.target.value, model: "" } } : {}) })}>
            <option value="">{t("settings.recovery.chooseEngine")}</option>
            {value.backup && !engine && <option value={value.backup.instanceId} disabled>{t("settings.recovery.unavailable", { name: value.backup.instanceId })}</option>}
            {engines.map((instance) => <option key={instance.instanceId} value={instance.instanceId}
              disabled={!instance.models.options.some((model) => instance.snapshot.authenticated !== false || model.custom)}>{instance.displayName}</option>)}
          </Select>
        </div>
        <div className={row}>
          <label htmlFor="automatic-recovery-model" className={label}>{t("settings.recovery.model")}</label>
          <Select size="sm" id="automatic-recovery-model" value={value.backup?.model ?? ""} disabled={saving || !value.enabled || !engine}
            onChange={(event) => change({ enabled: value.enabled, backup: { instanceId: engine!.instanceId, model: event.target.value } })}>
            <option value="">{t("settings.recovery.chooseModel")}</option>
            {value.backup?.model && !ready && <option value={value.backup.model} disabled>{t("settings.recovery.unavailable", { name: value.backup.model })}</option>}
            {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
          </Select>
        </div>
        <div className="flex justify-end px-3.5 py-2.5">
          <button type="button" disabled={!draft || saving || (value.enabled && !ready)} onClick={() => void save()} className="ui-button ui-button-primary">
            {saving ? t("settings.threads.saving") : t("common.save")}
          </button>
        </div>
        {saving && <span role="status" className="sr-only">{t("settings.threads.saving")}</span>}
        {error && <p role="alert" className="px-3.5 pb-2.5 text-[13px] leading-[18px] text-danger">{error}</p>}
      </SettingsRows>
    </SettingsGroup>
  );
}
