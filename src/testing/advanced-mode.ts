import { useSyncExternalStore } from "react";

/** For tests of code paths only the old Advanced mode reached: interface-mode as it was, a switch kept in memory over
 * the stored choice. `vi.mock("@/lib/interface-mode", () => import("@/testing/advanced-mode"))`. */
export const ADVANCED_MODE_KEY = "omb-advanced-mode";

let chosen: boolean | undefined;
const listeners = new Set<() => void>();

export function readAdvancedMode(): boolean {
  if (chosen !== undefined) return chosen;
  try {
    return globalThis.localStorage?.getItem(ADVANCED_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function settleAdvancedModeDefault(): void {}

export function setAdvancedMode(enabled: boolean): void {
  chosen = enabled;
  for (const listener of listeners) listener();
}

export function useAdvancedMode(): boolean {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, readAdvancedMode, () => false);
}
