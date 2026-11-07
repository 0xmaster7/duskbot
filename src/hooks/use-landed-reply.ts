import { useEffect, useState } from "react";

import { landedReply, LINE_BACK_AFTER_REPLY_MS } from "@/lib/turn-tail";
import type { Message } from "@/state/store";

const MAX_SEEN = 200;
/** when this client first saw each conversation's newest reply; a reply already there when the conversation was first
 * seen counts as long landed */
const seen = new Map<string, { id: string | null; at: number }>();

/** Tests only. */
export function resetLandedReplies(): void {
  seen.clear();
}

/** The bot's words after the person's newest message, and how long ago this client saw them land (null: none yet). */
export function useLandedReply(scope: string, messages: readonly Message[], speakerBotId?: string): { reply: Message | undefined; sinceMs: number | null } {
  const [, wake] = useState(0);
  const reply = landedReply(messages, speakerBotId);
  const now = Date.now();
  let entry = seen.get(scope);
  if (!entry) {
    entry = { id: reply?.id ?? null, at: -Infinity };
    seen.set(scope, entry);
    if (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value!);
  } else if (reply && entry.id !== reply.id) {
    entry.id = reply.id;
    entry.at = now;
  }
  const sinceMs = reply ? now - entry.at : null;
  const due = sinceMs !== null && sinceMs < LINE_BACK_AFTER_REPLY_MS ? entry.at + LINE_BACK_AFTER_REPLY_MS : null;
  useEffect(() => {
    if (due === null) return;
    const timer = setTimeout(() => wake((tick) => tick + 1), Math.max(0, due - Date.now()));
    return () => clearTimeout(timer);
  }, [due]);
  return { reply, sinceMs };
}
