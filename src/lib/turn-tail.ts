import type { Message } from "@/state/store";

/** Whether the mascot and its status line show under the transcript. They stay for the whole turn: a bot's text in the
 * middle of a turn ("Now I'll build the dashboard") is not its end, and the engine may then spend minutes writing a
 * file before its next step shows. A turn ends across three frames (reply, turn.completed, busy off), so a settled
 * reply at the tail keeps them only until it lands (replyHidesLine) and hides them for good once the turn has ended. */
export function showWorkingDots(
  busy: boolean | undefined,
  lastMessage: Message | undefined,
  speakerBotId?: string,
  turnEnded = false,
): boolean {
  if (!busy) return false;
  if (!lastMessage) return true;
  const settledReply = lastMessage.role === "bot" && lastMessage.kind === "text";
  if (!settledReply) return true;
  if (speakerBotId !== undefined && lastMessage.from?.botId !== speakerBotId) return true;
  return !turnEnded;
}

/** A turn still running this long after its reply landed shows the line again: it has more to do. */
export const LINE_BACK_AFTER_REPLY_MS = 1_500;
/** useTurnNow's phases that name no step: the wait itself, reasoning, the reply being written. */
const QUIET_PHASES: ReadonlySet<string | undefined> = new Set([undefined, "friendly:generic", "friendly:thinking", "friendly:chat.typing"]);

/** The bot's newest words after the person's newest message (in a room, the speaker's own), or none yet. */
export function landedReply(messages: readonly Message[], speakerBotId?: string): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role === "user" && message.kind === "text" && !message.reaction) return undefined;
    if (message.role === "bot" && message.kind === "text" && (speakerBotId === undefined || message.from?.botId === speakerBotId)) return message;
  }
  return undefined;
}

/** A reply that just landed takes the line's place in the same frame, whatever the engine still calls the turn; only a
 * named step, or the turn still running a while later, brings the line back under it. */
export function replyHidesLine(sinceReplyMs: number | null, phase: string | undefined): boolean {
  return sinceReplyMs !== null && sinceReplyMs < LINE_BACK_AFTER_REPLY_MS && QUIET_PHASES.has(phase);
}

export function awaitedMemberId(
  working: boolean | undefined,
  speakerBotId: string | null | undefined,
  lastMessage: Message | undefined,
): string | undefined {
  if (!working || speakerBotId) return undefined;
  if (lastMessage?.kind !== "activity" || !lastMessage.tool || lastMessage.tool.ok !== undefined) return undefined;
  return lastMessage.from?.botId;
}
