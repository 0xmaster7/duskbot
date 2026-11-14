import type { Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { plainFailureWords } from "@/lib/failed-reply";
import { cn } from "@/lib/cn";
import { ChatMarkdown } from "./ChatMarkdown";
import { SIMPLE_BOT_BUBBLE } from "./chat-bubble";

/** What one bot said to another, opened under its "Messaged X" or "Message from X" line, as a plain bubble. */
export function HandoffRow({ message }: { message: Message }) {
  const line = message.handoff;
  if (!line) return null;
  // a member that couldn't finish: plain words, never the engine's
  const failed = line.phase === "result" && message.tool?.ok === false;
  const words = line.phase === "sent" ? line.text?.trim() ?? ""
    : failed ? plainFailureWords(message.tool!.name) ?? t("failedReply.titleOne", { name: line.from.name })
    : message.tool?.output?.trim() ?? "";
  if (!words) return null;
  return (
    <div className="flex min-w-0 flex-col items-start" data-handoff-row={line.phase}>
      <div data-chat-bubble="simple" className={cn(SIMPLE_BOT_BUBBLE, "max-w-[min(38rem,100%)] [overflow-wrap:anywhere]", failed && "text-ink-secondary")}>
        {failed ? words : <div className="chat-text"><ChatMarkdown text={words} /></div>}
      </div>
    </div>
  );
}
