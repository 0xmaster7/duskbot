import { useEffect, useSyncExternalStore } from "react";

const reasons = new Set<string>();
const listeners = new Set<() => void>();
const changed = () => { for (const listener of listeners) listener(); };

export function ambientAway(): boolean {
  return reasons.size > 0;
}

export function onAmbientAway(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** While `active`, this screen covers the bots: the surfaces stay closed. */
export function useAmbientAway(reason: string, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    reasons.add(reason);
    changed();
    return () => { reasons.delete(reason); changed(); };
  }, [reason, active]);
}

export function useAmbientAwayValue(): boolean {
  return useSyncExternalStore(onAmbientAway, ambientAway, ambientAway);
}
