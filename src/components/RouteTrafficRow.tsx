import { useCallback, useEffect, useState } from "react";
import type { EgressStatus } from "../../shared/computer-egress";
import { t } from "@/lib/i18n";
import { NoteRow, SwitchRow } from "./ListRows";

const POLL_MS = 10_000;

/** Settings > Computer > Your computer: the bot computers' web traffic through the person's own computer. Only on a linked VPS. */
export function RouteTrafficRow() {
  const [status, setStatus] = useState<EgressStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/computer/egress", { signal, cache: "no-store" });
    if (!response.ok) return;
    setStatus(await response.json() as EgressStatus);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    const tick = () => void load(abort.signal).catch(() => {});
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => { abort.abort(); window.clearInterval(timer); };
  }, [load]);

  if (!status?.available) return null;

  const toggle = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/computer/egress", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !status.enabled }),
      });
      if (!response.ok) throw new Error();
      setStatus(await response.json() as EgressStatus);
    } catch {
      setError(t("routeTraffic.error"));
    } finally {
      setPending(false);
    }
  };

  const inApp = typeof window !== "undefined" && window.ogb?.remoteClient?.active === true;
  const fallback = status.enabled && status.route !== "computer";
  const hint = !status.enabled ? t("routeTraffic.hint") : fallback ? t("routeTraffic.offline") : t("routeTraffic.through");
  return (
    <>
      <SwitchRow
        data-settings-row="route-traffic"
        title={inApp ? t("routeTraffic.title") : t("routeTraffic.titleWeb")}
        hint={<span aria-live="polite" className={fallback ? "text-warning" : undefined}>{hint}</span>}
        checked={status.enabled}
        disabled={pending}
        onChange={() => void toggle()}
      />
      {error && <NoteRow tone="danger">{error}</NoteRow>}
    </>
  );
}
