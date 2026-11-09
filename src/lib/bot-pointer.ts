import { useSyncExternalStore } from "react";

/** Where a bot last pointed on its computer, in the desktop's own pixels; `sequence` counts its actions, `at` is when. */
export interface BotPointer {
  x: number;
  y: number;
  phase: "move" | "click";
  sequence: number;
  at: number;
}

// kept out of the app store: a pointer moves on every action and only the live view draws it
const pointers = new Map<string, BotPointer>();
const listeners = new Set<() => void>();
let sequence = 0;

const coordinate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 16_384;

/** A `computer-pointer` frame from the server. */
export function publishBotPointer(frame: Record<string, unknown>): void {
  const { botId, x, y, phase } = frame;
  if (typeof botId !== "string" || !coordinate(x) || !coordinate(y) || (phase !== "move" && phase !== "click")) return;
  pointers.set(botId, { x, y, phase, sequence: ++sequence, at: Date.now() });
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useBotPointer(botId: string | undefined): BotPointer | null {
  return useSyncExternalStore(subscribe, () => (botId ? pointers.get(botId) ?? null : null), () => null);
}
