// The ready-made bots the app's gallery offers, for a bot that creates one by chat (create_bot template). The same data as
// the gallery, so a bot made by chat is as good as one picked by hand.
import { READY_BOTS, readyBot, type ReadyBot } from "../src/lib/ready-bots.ts";

export type ReadyBotSummary = { template: string; name: string; title: string; description: string; category: string; apps: string[] };

/** What list_team_library shows a Chief: enough to pick one, never the full instructions. */
export function readyBotSummaries(): ReadyBotSummary[] {
  return READY_BOTS.map((bot) => ({ template: bot.id, name: bot.name, title: bot.title, description: bot.description, category: bot.category, apps: bot.apps }));
}

export function readyBotTemplate(id: unknown): ReadyBot | undefined {
  return typeof id === "string" ? readyBot(id.trim()) : undefined;
}

/** The template's routines as words for the creating bot: suggested, never created on the person's behalf. */
export function templateRoutineHints(bot: ReadyBot): string[] {
  return (bot.routines ?? []).map((routine) => {
    const schedule = routine.schedule as { time?: unknown };
    const when = typeof schedule.time === "string" ? ` at ${schedule.time}` : "";
    return `${routine.name}${when}: ${routine.prompt}`;
  });
}
