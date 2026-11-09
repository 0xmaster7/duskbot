import type { Bot } from "@/state/store";

type ActivityBot = Pick<Bot, "threadId" | "busy" | "turnStartedAt" | "tasks" | "messages" | "previewMessages">;

/** When the bot last did something its row reflects: a turn starting or a message from it arriving. The person's own
 * send in the open conversation does not count, so the row moves when the bot starts, as grok's does. */
export function botActivityAt(bot: ActivityBot): number {
  let at = bot.busy ? bot.turnStartedAt ?? 0 : 0;
  const held = bot.messages.length > 0 || Boolean(bot.previewMessages?.length);
  for (const list of [bot.messages, bot.previewMessages ?? []]) {
    const said = list.findLast((message) => message.role !== "user");
    if (said && Number.isFinite(said.at)) at = Math.max(at, said.at);
  }
  for (const task of bot.tasks ?? []) {
    if (task.routineRunId) continue;
    if (task.busy && task.turnStartedAt) at = Math.max(at, task.turnStartedAt);
    // the open conversation's stamp also moves on the person's own send; its messages say when the bot last spoke
    if (task.threadId !== bot.threadId || !held) at = Math.max(at, task.updatedAt ?? 0);
  }
  return at;
}

/** grok's list: the bot with the latest activity on top, at once, with no glide. Ties keep the person's saved order. */
export function latestActivityFirst<T>(bots: T[], at: (bot: T) => number): T[] {
  const stamps = bots.map(at);
  return bots.map((bot, index) => ({ bot, index })).sort((a, b) => stamps[b.index]! - stamps[a.index]! || a.index - b.index).map(({ bot }) => bot);
}
