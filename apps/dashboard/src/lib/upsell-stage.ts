import { useSyncExternalStore } from "react";

let invested = false;
const listeners = new Set<() => void>();

/** the home page's invested note took the stage this visit; the sidebar card stays out of its way until the next visit */
export function investedNoteShown() {
  if (invested) return;
  invested = true;
  listeners.forEach((fn) => fn());
}

export const useInvestedNoteShown = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => void listeners.delete(fn); }, () => invested, () => invested);
