import type { ServerFrame } from "../../shared/wire";

type Frame = Extract<ServerFrame, { kind: "browser-part" }>;
export type BrowserPart = Omit<Frame, "kind" | "phase"> & { phase: Exclude<Frame["phase"], "ready"> };

export function browserPartFromFrame(frame: Frame): BrowserPart | null {
  if (frame.phase === "ready" || frame.botIds.length === 0) return null;
  return { phase: frame.phase, received: frame.received, total: frame.total, botIds: [...frame.botIds] };
}

/** The line shows in a bot's chat only while that bot needed the browser and it is not here yet. */
export function browserPartFor(part: BrowserPart | null, botId: string): BrowserPart | null {
  return part && part.total > 0 && part.botIds.includes(botId) ? part : null;
}
