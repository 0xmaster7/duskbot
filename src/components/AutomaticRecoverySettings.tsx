import { useRef, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import { SettingRow, SettingsGroup, SettingsRows, Switch } from "./SettingsPrimitives";
import { SettingsSelect } from "./SettingsSelect";
import { NoteRow } from "./ListRows";

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
  const engineOptions = [
    { value: "", label: t("settings.recovery.chooseEngine") },
    ...(value.backup && !engine ? [{ value: value.backup.instanceId, label: t("settings.recovery.unavailable", { name: value.backup.instanceId }), disabled: true }] : []),
    ...engines.map((instance) => ({ value: instance.instanceId, label: instance.displayName,
      disabled: !instance.models.options.some((model) => instance.snapshot.authenticated !== false || model.custom) })),
  ];
  const modelOptions = [
    { value: "", label: t("settings.recovery.chooseModel") },
    ...(value.backup?.model && !ready ? [{ value: value.backup.model, label: t("settings.recovery.unavailable", { name: value.backup.model }), disabled: true }] : []),
    ...models.map((model) => ({ value: model.id, label: model.label })),
  ];
  return (
    <SettingsGroup block="recovery">
      <SettingsRows>
        <SettingRow title={t("settings.recovery.enable")} subtitle={value.enabled ? t(ready ? "settings.w6c.recovery.charges" : "settings.recovery.required") : undefined}>
          <Switch id="automatic-recovery-enabled" aria-label={t("settings.recovery.enable")} checked={value.enabled} disabled={saving || !state.config}
            onClick={() => change({ ...value, enabled: !value.enabled })} />
        </SettingRow>
        <SettingRow title={t("settings.recovery.engine")}>
          <SettingsSelect data-settings-select="automatic-recovery-engine" aria-label={t("settings.recovery.engine")} value={value.backup?.instanceId ?? ""} disabled={saving || !value.enabled}
            options={engineOptions}
            onChange={(event) => change({ enabled: value.enabled, ...(event.target.value ? { backup: { instanceId: event.target.value, model: "" } } : {}) })} />
        </SettingRow>
        <SettingRow title={t("settings.recovery.model")}>
          <SettingsSelect data-settings-select="automatic-recovery-model" aria-label={t("settings.recovery.model")} value={value.backup?.model ?? ""} disabled={saving || !value.enabled || !engine}
            options={modelOptions}
            onChange={(event) => change({ enabled: value.enabled, backup: { instanceId: engine!.instanceId, model: event.target.value } })} />
        </SettingRow>
        {draft && (
          <SettingRow title={t("settings.s2.unsaved")}>
            <button type="button" disabled={saving || (value.enabled && !ready)} onClick={() => void save()} className="ui-button ui-button-primary">
              {saving ? t("settings.threads.saving") : t("common.save")}
            </button>
          </SettingRow>
        )}
        {saving && <span role="status" className="sr-only">{t("settings.threads.saving")}</span>}
        {error && <NoteRow tone="danger">{error}</NoteRow>}
      </SettingsRows>
    </SettingsGroup>
  );
}
