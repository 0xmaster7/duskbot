const BUSY = new Set(["thinking", "working", "talking"]);

/**
 * @param {() => number} [now]
 * @returns {(snapshot: { bots: Array<Record<string, any>> } | null) => typeof snapshot} stamps `ran` (ms) on each bot
 * resting on news whose turn it saw run; the first summary is how things stand, so nothing in it gets a `ran`.
 */
export function createTurnClock(now = Date.now) {
  const started = new Map();
  const ran = new Map();
  return (snapshot) => {
    if (!snapshot) return snapshot;
    const ids = new Set();
    const bots = snapshot.bots.map((bot) => {
      ids.add(bot.id);
      const since = Number.isFinite(bot.since) && bot.since > 0 ? bot.since : null;
      if (BUSY.has(bot.status) || bot.status === "needs-you") {
        if (BUSY.has(bot.status) || started.has(bot.id)) started.set(bot.id, Math.min(started.get(bot.id) ?? Infinity, since ?? now()));
        ran.delete(bot.id);
        return bot;
      }
      if ((bot.status === "done" || bot.status === "error") && started.has(bot.id)) {
        ran.set(bot.id, { at: bot.at, ms: Math.max(0, now() - started.get(bot.id)) });
      }
      started.delete(bot.id);
      const turn = ran.get(bot.id);
      if (!turn || (bot.status !== "done" && bot.status !== "error") || turn.at !== bot.at) { ran.delete(bot.id); return bot; }
      return { ...bot, ran: turn.ms };
    });
    for (const id of [...started.keys()]) if (!ids.has(id)) started.delete(id);
    for (const id of [...ran.keys()]) if (!ids.has(id)) ran.delete(id);
    return { ...snapshot, bots };
  };
}
