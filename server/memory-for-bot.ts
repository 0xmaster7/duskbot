// memory_update for_bot_id: one note into ANOTHER bot's notebook, only when the person asked for it in their own words
// ("tell Scout I prefer short reports"). Security: another bot's notes load into its turns, so a teammate's ask, a room,
// a webhook or a guest never writes them, and the note always says which bot put it there.
import { reachRefusal, resolveTeammate, type RosterMember } from "./peer-roster.ts";

export type MemoryTarget<T> = { ok: true; target: T } | { ok: false; status: number; error: string };

export function memoryTarget<T extends RosterMember & { memoryEnabled?: boolean }>(args: {
  bots: readonly T[];
  sender: T;
  raw: string;
  action: unknown;
  /** The person's own words began this work, in a one-to-one conversation. */
  ownersAsk: boolean;
  /** A Team Cloud keeps a layer of notes per person; a note for another bot goes in that bot's own chat there. */
  team: boolean;
}): MemoryTarget<T> {
  if (args.action !== "append") return { ok: false, status: 400, error: "for_bot_id works only with action=append: one new note for that bot." };
  if (args.team) return { ok: false, status: 403, error: "On a team, notes for another bot are saved in that bot's own chat. Tell the person to say it to that bot there." };
  if (!args.ownersAsk) {
    return { ok: false, status: 403, error: "Only the person's own request in their chat with you can add to another bot's notes. Keep it in your reply instead." };
  }
  const resolved = resolveTeammate(args.bots, args.sender, args.raw);
  if ("error" in resolved) return { ok: false, status: 404, error: resolved.error };
  const target = args.bots.find((bot) => bot.id === resolved.id);
  if (!target) return { ok: false, status: 404, error: "No such bot: call list_bots and copy its id." };
  if (target.id === args.sender.id) return { ok: true, target };
  // an id resolves even for a bot this one may not reach: reaching it is checked here, as coordinate_bots does
  const refused = reachRefusal(args.sender, target);
  if (refused) return { ok: false, status: 403, error: refused.replace("nothing was sent", "nothing was saved") };
  if (target.memoryEnabled === false) return { ok: false, status: 403, error: `${target.name} has memory turned off, so nothing was saved. Tell the person.` };
  return { ok: true, target };
}
