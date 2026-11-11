import { useSyncExternalStore } from "react";
import { toast } from "./toast";

export interface Cheer { id: number; text: string }

let current: Cheer | null = null;
let next = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/** a small pixel bot pops up in the corner and cheers, with the words as a toast for screen readers too */
export function cheer(text: string) {
  current = { id: next++, text };
  toast(text);
  emit();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { current = null; timer = null; emit(); }, 2600);
}

/** cheers once per account and milestone, ever */
export function cheerOnce(accountId: string | null | undefined, milestone: string, text: string) {
  if (!accountId) return;
  const key = `omb-dash-milestone:${accountId}:${milestone}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch { return; }
  cheer(text);
}

export const useCheer = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => void listeners.delete(fn); }, () => current, () => null);
