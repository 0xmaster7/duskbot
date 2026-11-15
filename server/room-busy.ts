// A bot's own turn in a room never makes that room busy for it; other bots' turns, the room's other threads and
// question cards waiting on the person do.

export interface RoomBusyThread { threadId: string; title?: string }
export interface RoomBusyInput {
  /** The room's main conversation first, then its threads; every id is a conversation, never a member run. */
  threads: RoomBusyThread[];
  /** Bots speaking now, by the conversation they speak in. */
  speakers: Array<{ threadId: string; botId: string; name: string }>;
  /** Live room turns: the conversation each answers in and the bots it has claimed or lined up. */
  operations: Array<{ threadId: string; botIds: string[] }>;
  busyBotId?: string | null;
  /** Conversations with a question card still waiting on the person. */
  openCards: string[];
  name(botId: string): string;
  /** The bot asking from inside its own turn, and the conversation that turn answers in. */
  caller?: { botId: string; threadId: string };
}

const where = (input: RoomBusyInput, threadId: string) => {
  const thread = input.threads.find((one) => one.threadId === threadId);
  return !thread || thread === input.threads[0] || !thread.title ? "in this room" : `in the room's thread "${thread.title}"`;
};
const list = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** Null when the change may go ahead; otherwise one plain sentence naming what is busy. */
export function roomBusyReason(input: RoomBusyInput): string | null {
  const caller = input.caller;
  const ownTurn = (threadId: string, botId: string) => caller !== undefined && caller.botId === botId && caller.threadId === threadId;
  for (const speaker of input.speakers) {
    if (!ownTurn(speaker.threadId, speaker.botId)) return `${speaker.name} is answering ${where(input, speaker.threadId)} right now`;
  }
  for (const operation of input.operations) {
    const others = operation.botIds.filter((id) => !ownTurn(operation.threadId, id));
    if (others.length) {
      const names = others.map(input.name);
      return `${list(names)} ${names.length === 1 ? "is" : "are"} lined up to answer ${where(input, operation.threadId)}`;
    }
    if (!caller || operation.threadId !== caller.threadId) return `a turn is starting ${where(input, operation.threadId)}`;
  }
  if (input.busyBotId && input.busyBotId !== caller?.botId) return `${input.name(input.busyBotId)} is answering in this room right now`;
  const card = input.openCards[0];
  if (card) return `a question card ${where(input, card)} is waiting for the person's answer`;
  return null;
}

export const roomBusyError = (reason: string) =>
  `this room is busy: ${reason}. Try again once that finishes, or ask the person to make this change in the room's settings.`;
