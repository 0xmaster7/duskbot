// App moments that every on-screen mark of a bot answers: the sidebar row, the chat header and the status line.
import type { MarkReaction } from "./mascot-personality";

/** `watch`: the person is typing to the bot, so it looks down at the composer for a moment. */
export type MascotCue = MarkReaction | "watch";

const listeners = new Map<string, Set<(cue: MascotCue) => void>>();

export function cueMascot(botId: string, cue: MascotCue): void {
  for (const listener of Array.from(listeners.get(botId) ?? [])) listener(cue);
}

export function onMascotCue(botId: string, listener: (cue: MascotCue) => void): () => void {
  let set = listeners.get(botId);
  if (!set) listeners.set(botId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(botId);
  };
}
