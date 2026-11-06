import { Info, RefreshCw } from "lucide-react";
import { statusActivity } from "@/lib/activity-runs";
import { t } from "@/lib/i18n";
import { useStore, type Message } from "@/state/store";
import { bugReportFixedText } from "./BugReportNote";
import { CancelledTurnRow } from "./CancelledTurnRow";
import { FirstReplyRescueRow } from "./FirstReplyRescueRow";
import { smallButtonCls } from "./ui/GrokDialog";

// grok's status lines sit flat in the transcript: one grey 13px line and a glyph, no card
const line = "flex w-fit max-w-full text-[13px] leading-[18px] text-ink-secondary";

export function StatusActivityRow({ message }: { message: Message }) {
  const { dispatch } = useStore();
  const status = statusActivity(message);
  if (!status) return null;
  if (status.kind === "stopped") return <CancelledTurnRow name={message.tool?.name} />;
  if (message.tool?.rescue) return <FirstReplyRescueRow rescue={message.tool.rescue} text={status.text} at={message.at} />;
  const Icon = status.kind === "recovery" ? RefreshCw : Info;
  // A notice that signing in fixes (an AI signed out) opens the place to sign in again.
  if (status.kind === "notice" && message.tool?.setup === true) {
    return (
      <div role="status" className={`${line} flex-wrap items-center gap-x-2 gap-y-1`}>
        <span className="flex min-w-0 items-start gap-2">
          <Icon size={13} aria-hidden="true" className="mt-[2.5px] shrink-0" />
          <span className="min-w-0 break-words">{status.text}</span>
        </span>
        <button type="button" className={smallButtonCls} title={t("chat.notice.signInHint")}
          onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "engines" })}>
          {t("chat.notice.signIn")}
        </button>
      </div>
    );
  }
  return (
    <div role="status" className={`${line} items-start gap-2`}>
      <Icon size={13} aria-hidden="true" className="mt-[2.5px] shrink-0" />
      <span className="min-w-0 break-words">{(message.bugReport && bugReportFixedText(message.bugReport)) ?? status.text}</span>
    </div>
  );
}
