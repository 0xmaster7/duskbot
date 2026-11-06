import { useRef, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import { SettingRow } from "./SettingsPrimitives";
import { SettingsSelect } from "./SettingsSelect";

export function ThreadConcurrencySettings() {
  const { state, dispatch } = useStore();
  const confirmed = state.config?.threads?.maxConcurrentPerBot ?? 3;
  const oneThreadPerBot = state.config?.cloudStarter === true;
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const save = async (limit: number) => {
    if (saving.current || limit === confirmed) return;
    saving.current = true;
    setPending(limit);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ threads: { maxConcurrentPerBot: limit } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.threads.error"));
    } finally {
      saving.current = false;
      setPending(null);
    }
  };
  return (
    <SettingRow
      title={t("settings.w6c.threads.label")}
      subtitle={oneThreadPerBot ? t("settings.threads.starter") : pending !== null ? t("settings.threads.saving") : undefined}
      message={error ? <p role="alert" className="text-danger">{error}</p> : null}
    >
      <SettingsSelect
        data-settings-select="thread-concurrency"
        value={String(pending ?? confirmed)}
        disabled={pending !== null || oneThreadPerBot}
        aria-label={t("settings.w6c.threads.label")}
        options={Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
        onChange={(event) => void save(Number(event.target.value))}
      />
    </SettingRow>
  );
}
