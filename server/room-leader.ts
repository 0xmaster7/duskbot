import type { GroupDefaultResponder } from "../shared/wire.ts";

/** Rounds a leader may hand out work in for one message of the person's: its first turn and each time results wake it. */
export const LEADER_MAX_ROUNDS = 3;
/** Tasks a leader may hand out for one message, across its rounds. */
export const LEADER_MAX_TASKS = 8;

type Room = { dm?: boolean; memberIds: string[]; defaultResponder: GroupDefaultResponder };
type Member = { id: string; name: string; title?: string; description?: string; hidden?: boolean };

/** The member that leads this room, when the room has a leader and that member is still in it. */
export function roomLeaderId(room: Room | null | undefined): string | undefined {
  if (!room || room.dm) return undefined;
  const responder = room.defaultResponder;
  return responder?.kind === "member" && responder.leader === true && room.memberIds.includes(responder.botId) ? responder.botId : undefined;
}

const oneLine = (value: string | undefined, max: number) => {
  const flat = (value ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** The leader's note: who is on the team, and how hand-offs work here. */
export function leaderSystemNote(leader: Pick<Member, "id" | "name">, members: readonly Member[], person: string): string {
  const team = members.filter((member) => member.id !== leader.id && !member.hidden);
  const roster = team.length
    ? team.map((member) => {
      const about = oneLine(member.title || member.description, 140);
      return `- ${oneLine(member.name, 60)} [id: ${member.id}]${about ? `: ${about}` : ""}`;
    }).join("\n")
    : "- Nobody else is in this group yet.";
  return [
    `You lead this group, like the head of a department. ${person} talks with you; the others are your team:`,
    roster,
    "Plan first. Do quick things yourself; hand real work to the member it fits with coordinate_bots (their id, one clear self-contained task each, what done looks like). Send independent tasks in one call so they run side by side, then end your turn: each hand-off shows in the group, and you are woken once with their results.",
    `When results come back, check them against the request, send a concrete fix with rework=true or the next step when needed, then give ${person} one short wrap-up. A member that failed or stalled is yours to handle: retry, reassign, or say plainly what is missing. Never claim work a member has not reported.`,
    `Keep it tight: at most ${LEADER_MAX_ROUNDS} rounds of hand-offs and ${LEADER_MAX_TASKS} tasks per message, never the same task twice, and never hand work to yourself.`,
  ].join("\n");
}

/** A member's note when its leader handed it the task. */
export function memberSystemNote(leaderName: string, roomName: string): string {
  return `You are working for ${leaderName}, who leads the group "${roomName}". Do this task on your own, then report back concisely: what you did, the result, anything left open. If something blocks you, end your turn with one clear question for ${leaderName}; it comes back to you with the answer. Do not hand this task on to others.`;
}

/** Why a leader may not hand out more work for this message, or null when it may. */
export function leaderCapRefusal(input: { round: number; tasksSoFar: number; adding: number }): string | null {
  if (input.round > LEADER_MAX_ROUNDS) {
    return `You have handed out work in ${LEADER_MAX_ROUNDS} rounds for this message, the limit. Nothing was sent: wrap up for the person now with what the team reported, and name anything still open.`;
  }
  if (input.tasksSoFar + input.adding > LEADER_MAX_TASKS) {
    return `That would make ${input.tasksSoFar + input.adding} tasks for this message; the limit is ${LEADER_MAX_TASKS}. Nothing was sent: send fewer, or wrap up with what you have.`;
  }
  return null;
}
