import { useEffect, useRef, useState } from "react";

import {
  MAX_ROOM_TURN_TIMEOUT_MINUTES,
  MIN_ROOM_TURN_TIMEOUT_MINUTES,
  parseRoomTurnTimeoutMinutes,
} from "@/lib/room-turn-timeout";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";

export function RoomTurnTimeoutSettings() {
  const { state, dispatch } = useStore();
  const confirmedMinutes = state.config?.rooms.turnTimeoutMinutes ?? 5;
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
    const parsed = parseRoomTurnTimeoutMinutes(value);
    if (!parsed.ok) {
      setError(t("settings.roomTurns.range"));
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PUT",
        body: JSON.stringify({ rooms: { turnTimeoutMinutes: parsed.minutes } }),
      });
      dispatch({ type: "configStatus", config });
      setValue(String(config.rooms.turnTimeoutMinutes));
      setDirty(false);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.roomTurns.error"));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <label htmlFor="room-turn-timeout" className="min-w-0 flex-1 text-[13px] leading-[18px] text-ink">
        {t("settings.w6c.roomTurns.label")}
      </label>
      <div
        className={`flex h-8 w-[150px] shrink-0 items-center rounded-[10px] border bg-transparent ${
          error ? "border-danger/60" : "border-ink/10"
        }`}
      >
        <input
          id="room-turn-timeout"
          type="number"
          min={MIN_ROOM_TURN_TIMEOUT_MINUTES}
          max={MAX_ROOM_TURN_TIMEOUT_MINUTES}
          step={1}
          inputMode="numeric"
          value={value}
          disabled={saving}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "room-turn-timeout-error" : undefined}
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
        <span className="pr-3 text-[13px] text-ink-secondary">{t("settings.roomTurns.minutes")}</span>
      </div>
      {error ? (
        <p id="room-turn-timeout-error" role="alert" className="basis-full text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
