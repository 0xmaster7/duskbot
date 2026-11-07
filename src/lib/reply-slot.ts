import type { Message } from "@/state/store";

/** What the one reply slot under the person's message shows: the bot's mark right after a send, then its typing dots in
 * a bubble that becomes the reply, or the working line while the bot does named work. Never two at once. */
export type ReplySlotPhase = "hidden" | "mascot" | "dots" | "status";

/** the mark plays alone this long after a send before it turns into the dots, unless the reply starts first */
export const MASCOT_MS = 700;
/** however soon the reply starts, the mark gets this long, so its moment is seen and never flashes */
export const MASCOT_MIN_MS = 400;
/** a wait with no step to name becomes the working line after this long */
export const LONG_WAIT_MS = 8_000;
/** a turn still running this long after its reply landed has more to do: the working line comes back */
export const AFTER_REPLY_MS = 1_500;
/** a message sent from here keeps its slot this long while the server confirms it and starts the turn */
export const SEND_GRACE_MS = 5_000;

const TYPING_PHASE = "friendly:chat.typing";
/** useTurnNow's phases that name no step: the wait itself, reasoning, the reply being written */
const QUIET_PHASES: ReadonlySet<string | undefined> = new Set([undefined, "friendly:generic", "friendly:thinking", TYPING_PHASE]);

export interface ReplySlotInput {
  /** the bot runs a turn here, or the person's message was just sent and waits for one */
  waiting: boolean;
  /** the bot's words already stand under the person's newest message (landedReply) */
  landed: boolean;
  /** useTurnNow's phase for what the bot is doing now */
  phase: string | undefined;
  /** reply text is streaming in right now */
  streaming: boolean;
  /** the turn reported its end */
  ended: boolean;
  /** ms since this wait began */
  waitedMs: number;
  /** ms since that reply landed */
  sinceReplyMs: number;
  /** this wait already showed the working line, so it does not drop back to dots between steps */
  worked: boolean;
}

/** The bot's newest words after the person's newest message (in a room, the answering bot's own), or none yet. */
export function landedReply(messages: readonly Message[], speakerId?: string): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role === "user" && message.kind === "text" && !message.reaction) return undefined;
    if (message.role === "bot" && message.kind === "text" && (speakerId === undefined || message.from?.botId === speakerId)) return message;
  }
  return undefined;
}

export function replySlotPhase(input: ReplySlotInput): ReplySlotPhase {
  if (!input.waiting) return "hidden";
  const named = !QUIET_PHASES.has(input.phase);
  if (input.landed) {
    // a reply on screen ends the wait in the frame it lands; the engine may still call it typing for a moment
    if (input.ended) return "hidden";
    if (input.streaming) return "dots";
    return named || input.sinceReplyMs >= AFTER_REPLY_MS ? "status" : "hidden";
  }
  const typing = input.streaming || input.phase === TYPING_PHASE;
  if (typing) return input.waitedMs >= MASCOT_MIN_MS ? "dots" : "mascot";
  if (named || input.worked || input.waitedMs >= LONG_WAIT_MS) return "status";
  return input.waitedMs >= MASCOT_MS ? "dots" : "mascot";
}

/** ms until the phase can change with no new frame, or null when only a new frame can change it. */
export function nextReplySlotChange(input: ReplySlotInput): number | null {
  if (!input.waiting) return null;
  if (input.landed) {
    return !input.ended && !input.streaming && input.sinceReplyMs < AFTER_REPLY_MS ? AFTER_REPLY_MS - input.sinceReplyMs : null;
  }
  if (input.streaming || input.phase === TYPING_PHASE) return input.waitedMs < MASCOT_MIN_MS ? MASCOT_MIN_MS - input.waitedMs : null;
  if (replySlotPhase(input) === "status") return null;
  return (input.waitedMs < MASCOT_MS ? MASCOT_MS : LONG_WAIT_MS) - input.waitedMs;
}

/** What one wait is keyed by: the person's newest message, its optimistic copy and the server's sharing a sendId. */
export function waitKey(messages: readonly Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role === "user" && message.kind === "text" && !message.reaction) return message.sendId ?? message.id;
  }
  return "";
}

/** A message the person just sent and the server has not confirmed yet. */
export function justSent(tail: Message | undefined): boolean {
  return Boolean(tail && tail.role === "user" && tail.id.startsWith("optimistic-"));
}
