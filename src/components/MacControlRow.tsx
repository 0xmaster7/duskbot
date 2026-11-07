import { useCallback, useEffect, useState } from "react";
import type { MacControlStatus } from "../../shared/mac-control";
import { t } from "@/lib/i18n";
import { NoteRow, SwitchRow } from "./ListRows";

const POLL_MS = 10_000;

/** GET /api/mac, polled while mounted; null until it answers or when this server has none. */
export function useMacControl(): [MacControlStatus | null, (next: MacControlStatus) => void] {
  const [status, setStatus] = useState<MacControlStatus | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/mac", { signal, cache: "no-store" });
    if (response.ok) setStatus(await response.json() as MacControlStatus);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    const tick = () => void load(abort.signal).catch(() => {});
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => { abort.abort(); window.clearInterval(timer); };
  }, [load]);
  return [status, setStatus];
}

/** Settings > Computer > Your computer: whether this linked VPS's bots may use the owner's Mac. Only once a Mac served it. */
export function MacControlRow() {
  const [status, setStatus] = useMacControl();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!status?.available) return null;

  const toggle = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/mac", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !status.enabled }) });
      if (!response.ok) throw new Error();
      setStatus(await response.json() as MacControlStatus);
    } catch {
      setError(t("macControl.error"));
    } finally {
      setPending(false);
    }
  };

  const hint = !status.enabled ? t("macControl.hint") : status.online ? t("macControl.online", { name: status.name ?? "Mac" }) : t("macControl.offline");
  return (
    <>
      <SwitchRow
        data-settings-row="mac-control"
        title={t("macControl.title")}
        hint={<span aria-live="polite">{hint}</span>}
        checked={status.enabled}
        disabled={pending}
        onChange={() => void toggle()}
      />
      {error && <NoteRow tone="danger">{error}</NoteRow>}
    </>
  );
}
