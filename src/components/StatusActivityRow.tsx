import { use } from "react";
import { statusActivity } from "@/lib/activity-runs";
import type { Message } from "@/state/store";
import { bugReportFixedText } from "./BugReportNote";
import { CancelledTurnRow } from "./CancelledTurnRow";
import { ChatErrorCard } from "./ChatErrorBanner";
import { FoldedNoticesContext } from "./FailedReplyCard";
import { FirstReplyRescueRow } from "./FirstReplyRescueRow";

// a notice is said in the card above the composer while it is the newest thing; once something follows, an older one
// stays as a quiet card in the chat, never a bare grey line
export function StatusActivityRow({ message }: { message: Message }) {
  const folded = use(FoldedNoticesContext);
  const status = statusActivity(message);
  if (!status) return null;
  if (status.kind === "stopped") return <CancelledTurnRow name={message.tool?.name} />;
  if (message.tool?.rescue) return <FirstReplyRescueRow rescue={message.tool.rescue} text={status.text} at={message.at} />;
  if (folded.has(message.id)) return null;
  // a sign-out something has since followed: the AI's own status says the rest
  if (status.kind === "notice" && message.tool?.setup === true) return null;
  return (
    <div className="flex justify-start">
      <ChatErrorCard
        tone="info"
        className="w-fit max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct))]"
        title={(message.bugReport && bugReportFixedText(message.bugReport)) ?? status.text}
      />
    </div>
  );
}
