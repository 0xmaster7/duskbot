import { useEffect, useRef, useState, type ComponentProps, type ComponentType, type Ref } from "react";

import { AFTER_REPLY_MS, justSent, landedReply, LONG_WAIT_MS, nextReplySlotChange, SEND_GRACE_MS, replySlotPhase, waitKey, type ReplySlotInput, type ReplySlotPhase } from "@/lib/reply-slot";
import { lastNonReceipt } from "@/lib/receipts";
import type { Message } from "@/state/store";
import { useThinkingMoment } from "@/hooks/use-thinking-moment";
import { BotAvatar, type MausAvatarHandle } from "./Avatar";
import type { MarkState } from "./mascot-motion-mark";
import { WorkingDots } from "./WorkingIndicator";

const Mark = BotAvatar as unknown as ComponentType<ComponentProps<typeof BotAvatar> & { ref?: Ref<MausAvatarHandle> }>;

/** The bot's answer before it has words: its mark playing a short moment right after the send, then three typing dots in
 * a bubble that opens out of a circle around the mark (chat.css). The reply's own bubble grows out of that one when it
 * lands (use-arrival-flow.ts). */
export function ReplySlot({ phase, bot, markState }: {
  phase: "mascot" | "dots";
  bot: ComponentProps<typeof BotAvatar>["bot"];
  markState: MarkState;
}) {
  const mark = useRef<MausAvatarHandle>(null);
  useThinkingMoment(mark, phase === "mascot");
  return (
    <div data-reply-slot={phase} className="reply-slot" aria-hidden="true">
      <span className="reply-slot-bubble" />
      <span className="reply-slot-mark">
        <Mark ref={mark} bot={bot} size={22} state={markState} eyeInk="var(--color-app)" forward={false} lookAround={1} trackPointer={false} />
      </span>
      <span className="reply-slot-dots">{phase === "dots" && <WorkingDots size={6} />}</span>
    </div>
  );
}

interface Clock {
  key: string;
  startedAt: number;
  /** the wait began with a send from this client */
  sent: boolean;
  worked: boolean;
  replyId: string | null;
  replyAt: number;
}

const MAX_CLOCKS = 200;
const clocks = new Map<string, Clock>();

/** Tests only. */
export function resetReplySlotClocks(): void {
  clocks.clear();
}

/** The reply slot's phase for one conversation (and, in a room, one bot), timed from when this client saw the wait begin
 * and the reply land, so a server clock that runs apart never shortens the mark's moment. A conversation first seen in the
 * middle of a long turn (`since`, the turn's start) or after its reply skips the moments it missed. */
export function useReplySlotPhase({ scope, messages, speakerId, waiting, phase, streaming, ended, since }: {
  scope: string;
  messages: readonly Message[];
  speakerId?: string;
  waiting: boolean;
  phase: string | undefined;
  streaming: boolean;
  ended: boolean;
  since?: number | null;
}): { phase: ReplySlotPhase; reply: Message | undefined } {
  const [, wake] = useState(0);
  const now = Date.now();
  const key = waitKey(messages);
  const reply = landedReply(messages, speakerId);
  let clock = clocks.get(scope);
  if (!clock || clock.key !== key) {
    const joined = clock === undefined;
    const long = joined && since != null && now - since > 2 * LONG_WAIT_MS;
    clock = { key, startedAt: long ? since : now, sent: justSent(lastNonReceipt(messages)), worked: false, replyId: joined ? reply?.id ?? null : null, replyAt: now - (joined ? AFTER_REPLY_MS : 0) };
    clocks.delete(scope);
    clocks.set(scope, clock);
    if (clocks.size > MAX_CLOCKS) clocks.delete(clocks.keys().next().value!);
  }
  if (reply && clock.replyId !== reply.id) {
    clock.replyId = reply.id;
    clock.replyAt = now;
  }
  const waitedMs = now - clock.startedAt;
  // the server's copy replaces the sent one a moment before the turn starts: the slot holds through that gap
  const confirming = clock.sent && !reply && waitedMs < SEND_GRACE_MS && lastNonReceipt(messages)?.role === "user";
  const input: ReplySlotInput = {
    waiting: waiting || confirming, phase, streaming, ended,
    landed: reply !== undefined,
    waitedMs,
    sinceReplyMs: reply ? now - clock.replyAt : 0,
    worked: clock.worked,
  };
  const shown = replySlotPhase(input);
  if (shown === "status" && !reply) clock.worked = true;
  const changes = [nextReplySlotChange(input), confirming && !waiting ? SEND_GRACE_MS - waitedMs : null].filter((ms) => ms !== null);
  const due = changes.length > 0 ? now + Math.min(...changes) : null;
  useEffect(() => {
    if (due === null) return;
    const timer = setTimeout(() => wake((tick) => tick + 1), Math.max(0, due - Date.now()));
    return () => clearTimeout(timer);
  }, [due]);
  return { phase: shown, reply };
}
