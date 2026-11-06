import { useEffect, useRef, useState } from "react";

import {
  MAX_MCP_CALL_TIMEOUT_MINUTES,
  MIN_MCP_CALL_TIMEOUT_MINUTES,
  mcpCallTimeoutMinutes,
  parseMcpCallTimeoutMinutes,
} from "@/lib/mcp-call-timeout";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";

export function McpCallTimeoutSettings() {
  const { state, dispatch } = useStore();
  const confirmedMinutes = mcpCallTimeoutMinutes(state.config);
  const [value, setValue] = useState(String(confirmedMinutes));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);

  useEffect(() => {
    if (!dirty) setValue(String(confirmedMinutes));
  }, [confirmedMinutes, dirty]);

  const save = async () => {
    if (!dirty || saveInFlight.current) return;
    const parsed = parseMcpCallTimeoutMinutes(value);
    if (!parsed.ok) {
      setError(t("settings.mcpCalls.range"));
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PUT",
        body: JSON.stringify({ mcp: { callTimeoutMinutes: parsed.minutes } }),
      });
      dispatch({ type: "configStatus", config });
      setValue(String(mcpCallTimeoutMinutes(config)));
      setDirty(false);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.mcpCalls.error"));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <label htmlFor="mcp-call-timeout" className="min-w-0 flex-1 text-[13px] leading-[18px] text-ink">
        {t("settings.w6c.mcpCalls.label")}
      </label>
      <div
        className={`flex h-8 w-[150px] shrink-0 items-center rounded-[10px] border bg-transparent ${
          error ? "border-danger/60" : "border-ink/10"
        }`}
      >
        <input
          id="mcp-call-timeout"
          type="number"
          min={MIN_MCP_CALL_TIMEOUT_MINUTES}
          max={MAX_MCP_CALL_TIMEOUT_MINUTES}
          step={1}
          inputMode="numeric"
          value={value}
          disabled={saving}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "mcp-call-timeout-error" : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setDirty(true);
            setError("");
          }}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="h-full min-w-0 flex-1 bg-transparent px-[9px] text-[13px] tabular-nums text-ink outline-none"
        />
        <span className="pr-3 text-[13px] text-ink-secondary">{t("settings.mcpCalls.minutes")}</span>
      </div>
      {error ? (
        <p id="mcp-call-timeout-error" role="alert" className="basis-full text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
