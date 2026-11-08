import { useSyncExternalStore } from "react";

export interface Toast { id: number; text: string; tone: "plain" | "bad" }

const listeners = new Set<() => void>();
let list: Toast[] = [];
let next = 1;
const set = (value: Toast[]) => { list = value; listeners.forEach((fn) => fn()); };

/** shows a short line at the bottom of the page; keeps the newest three */
export function toast(text: string, tone: Toast["tone"] = "plain") {
  const id = next++;
  set([...list.slice(-2), { id, text, tone }]);
  setTimeout(() => set(list.filter((t) => t.id !== id)), 4200);
}

export const useToasts = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => void listeners.delete(fn); }, () => list, () => list);
