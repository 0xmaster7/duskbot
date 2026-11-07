// The day and time line between a conversation's days (ChatView.tsx).
import { cn } from "@/lib/cn";
import { dayLabel } from "@/lib/transcript-derivations";
import { formatTime } from "@/state/store";
import type { Message } from "@/state/store";

/** Who wrote a row, so a stamp knows whether the conversation changes hands across it. */
function senderOf(message: Message): string {
  return message.role === "bot" ? `bot:${message.from?.botId ?? ""}` : `${message.role}:${message.from?.name ?? ""}`;
}

/** Grok's stamp: 12/16 text 24px under the row above and 18px over the row below, 30px when the next row is someone
 * else's (its sender-change 12px). */
export function DaySeparator({ at, today, prev, next }: { at: number; today: number; prev?: Message; next?: Message }) {
  const handsOver = Boolean(prev && next && senderOf(prev) !== senderOf(next));
  return (
    <div className={cn("pt-2 text-center text-[12px] leading-4 text-ink-secondary", handsOver ? "pb-3.5" : "pb-0.5")}>
      {dayLabel(at, today)} {formatTime(at)}
    </div>
  );
}
