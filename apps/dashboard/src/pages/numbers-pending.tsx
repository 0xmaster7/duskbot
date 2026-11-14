import { useEffect, useState } from "react";
import { useCloud } from "../data/cloud";
import type { CloudDesktop } from "../data/contracts";
import { Button, Card, Skeleton } from "../ui/kit";
import { LoadError } from "./common";

export const SKELETON_MS = 6_000;
const WAKE_POLL_MS = 4_000;

export function useLate(ms = SKELETON_MS): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLate(true), ms); return () => clearTimeout(t); }, [ms]);
  return late;
}

/** a cloud or workspace whose numbers are not here: a skeleton for a few seconds, then plain words with a retry */
export function NumbersPending({ cloud, error, retry, className = "h-[170px] !rounded-card" }: { cloud: CloudDesktop | null; error: string | null; retry(): void; className?: string }) {
  const late = useLate();
  const { power, refresh } = useCloud();
  const [busy, setBusy] = useState(false);
  const [wakeError, setWakeError] = useState<string | null>(null);
  const waking = Boolean(cloud && (cloud.resting || cloud.status === "waking"));
  // a resting cloud reads as running, so the list poller stays slow; ask for it sooner while we wait on the wake
  useEffect(() => {
    if (!waking) return;
    const t = setInterval(refresh, WAKE_POLL_MS);
    return () => clearInterval(t);
  }, [waking, refresh]);
  if (error && !waking) return <Card><LoadError error={error} retry={retry} /></Card>;
  if (!late) return <Skeleton className={className} />;
  const again = async () => {
    setBusy(true); setWakeError(null);
    try { if (waking && cloud) await power(cloud.id, true); retry(); refresh(); }
    catch (e) { setWakeError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Card aria-live="polite">
      <p className="text-14 text-ink">{waking ? `waking ${cloud!.name}` : "its numbers are not here yet"}</p>
      <p className="mt-1 text-13 text-ink-3">{waking ? "it usually takes a few seconds. its numbers show here once it is up." : "it may still be starting. they show here as soon as it reports."}</p>
      {wakeError && <p role="alert" className="mt-3 text-13 text-bad">{wakeError}</p>}
      <Button className="mt-4" size="sm" disabled={busy} onClick={() => void again()}>{busy ? "trying" : "try again"}</Button>
    </Card>
  );
}
