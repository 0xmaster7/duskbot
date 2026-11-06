import { useRef, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import { Card } from "./SettingsPrimitives";
import { Select } from "./Select";

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
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <label htmlFor="thread-concurrency" className="min-w-0 flex-1 text-[13px] leading-[18px] text-ink">{t("settings.w6c.threads.label")}</label>
        <Select id="thread-concurrency" value={pending ?? confirmed} disabled={pending !== null || oneThreadPerBot}
          aria-describedby={oneThreadPerBot ? "thread-concurrency-help" : undefined}
          onChange={(event) => void save(Number(event.target.value))}>
          {Array.from({ length: 16 }, (_, i) => i + 1).map((limit) => <option key={limit} value={limit}>{limit}</option>)}
        </Select>
      </div>
      {oneThreadPerBot && <p id="thread-concurrency-help" className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("settings.threads.starter")}</p>}
      {pending !== null && <p role="status" className="mt-2 text-[12px] text-ink-secondary">{t("settings.threads.saving")}</p>}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </Card>
  );
}
