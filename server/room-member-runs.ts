// A member run is the runtime identity of one member's turn in a room conversation, so several members can answer
// at once: the engine, its events and every per-turn map key on the run, while the store reads and writes the room's
// own thread for it. Ids keep to [\w-].
const MARK = "--member--";

export function memberRunThreadId(threadId: string, botId: string): string {
  return `${threadId}${MARK}${botId}`;
}

export function parseMemberRun(id: string): { threadId: string; botId: string } | null {
  const at = id.indexOf(MARK);
  if (at <= 0) return null;
  const threadId = id.slice(0, at), botId = id.slice(at + MARK.length);
  return botId && !botId.includes(MARK) ? { threadId, botId } : null;
}

/** The room conversation a member run answers in; any other id is its own. */
export function conversationOfRun(id: string): string {
  return parseMemberRun(id)?.threadId ?? id;
}
