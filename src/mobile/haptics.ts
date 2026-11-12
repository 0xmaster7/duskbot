import { useSyncExternalStore } from "react";
import type { HapticKind, MobilePlatform } from "./platform";

const HAPTICS_KEY = "dusk.mobile.haptics";
let platform: MobilePlatform | null = null;
let enabled = true;
const listeners = new Set<() => void>();
const lastAt = new Map<HapticKind, number>();

export async function installHaptics(next: MobilePlatform): Promise<void> {
  platform = next;
  enabled = (await next.prefs.get(HAPTICS_KEY)) !== "off";
  for (const listener of listeners) listener();
}

/** One tap of the device's taptic engine. Repeats of one kind inside 40 ms collapse: a burst of frames is one event. */
export function haptic(kind: HapticKind): void {
  if (!enabled || !platform) return;
  const now = performance.now();
  if (now - (lastAt.get(kind) ?? 0) < 40) return;
  lastAt.set(kind, now);
  platform.haptic(kind);
}

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
  void platform?.prefs.set(HAPTICS_KEY, on ? "on" : "off");
  for (const listener of listeners) listener();
}

export function useHapticsEnabled(): boolean {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => enabled,
  );
}
