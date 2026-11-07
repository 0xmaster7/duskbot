import { useState } from "react";
import type { Bot, MausColor, Message } from "@/state/store";
import { handoffResult } from "@/lib/handoff-result";
import { t } from "@/lib/i18n";
import { plainFailureWords } from "@/lib/failed-reply";
import { cn } from "@/lib/cn";
import { BotAvatar } from "./Avatar";

/** A hand-off read as part of the chat: one flat line, "Nova → Quill  draft the launch post", or a member's report back
 * with its first line and the rest a click away. Opening it goes to the thread the work ran in. */
export function HandoffRow({ message, bots, onOpen }: { message: Message; bots: readonly Bot[]; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const line = message.handoff;
  if (!line) return null;
  const result = line.phase === "result" ? handoffResult(message) : null;
  // a member that couldn't finish: plain words, never the engine's
  const failed = line.phase === "result" && message.tool?.ok === false;
  const words = line.phase === "sent" ? line.text ?? ""
    : failed ? plainFailureWords(message.tool!.name) ?? t("failedReply.titleOne", { name: line.from.name })
    : result?.preview ?? "";
  const from = bots.find((bot) => bot.id === line.from.botId) ?? { name: line.from.name, color: line.from.color as MausColor };
  const title = line.phase === "sent"
    ? t("chat.handoff.sentTitle", { from: line.from.name, to: line.to.name })
    : t("chat.handoff.resultTitle", { from: line.from.name, to: line.to.name });
  return (
    <div className="flex min-w-0 flex-col items-start" data-handoff-row={line.phase}>
      <button
        type="button"
        onClick={() => (result?.more ? setOpen((value) => !value) : onOpen?.())}
        title={title}
        aria-expanded={result?.more ? open : undefined}
        className="flex max-w-[min(38rem,100%)] min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-left text-[13px] leading-5 hover:bg-ink/[0.035] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <BotAvatar bot={from} state="happy" size={18} animated={false} />
        <span className="shrink-0 font-medium text-ink">{line.from.name}</span>
        <span className="shrink-0 text-ink-secondary" aria-hidden="true">→</span>
        <span className="shrink-0 font-medium text-ink">{line.to.name}</span>
        {words && <span className={cn("min-w-0 truncate text-ink-secondary", "ms-1")}>{words}</span>}
      </button>
      {open && result?.more && (
        <div className="ms-8 mt-0.5 max-w-[min(36rem,100%)] text-[13px] leading-5 whitespace-pre-wrap break-words text-ink">
          {result.more}
          {onOpen && (
            <button type="button" onClick={onOpen} className="mt-1 block text-[12px] text-ink-secondary hover:text-ink">
              {t("chat.handoff.openThread")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
