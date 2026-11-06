import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { plainErrorLine } from "@/lib/plain-error";
import type { AppState } from "@/state/store";
import { GrokIcon } from "./GrokIcon";
import { NoticeGlyph } from "./ui/Notice";

// grok's prompt notices: one 12/16 line above the message box, no box, 2px in from its edge
const NOTICE_LINE = "flex items-start gap-1.5 px-0.5 text-[12px] leading-4";

export function ChatNotice({ notice }: { notice: AppState["notice"] }) {
  if (!notice) return null;
  return (
    <div className="w-full px-5">
      <div role="status" className={`mb-2 ${NOTICE_LINE} text-ink-secondary`}>
        {notice.kind === "note"
          ? notice.text
          : notice.kind === "steer-images"
            ? t("composer.queued.steerImagesHeld")
            : notice.kind === "bot-gone"
              ? t("thread.botGone")
              : notice.botName ? t("conversation.goneShowing", { name: notice.botName }) : t("conversation.gone")}
      </div>
    </div>
  );
}

// grok's error tray: a card on a hairline with one coloured glyph, a 14/20 title, quiet words, ink pill actions
const CARD = "flex items-start gap-2.5 rounded-[14px] border border-ink/[0.08] bg-composer px-3 py-2.5 text-[13px] leading-[18px] text-ink";
export const CARD_ACTION = "ui-button ui-button-sm ui-button-pill border-transparent bg-ink/[0.06] text-ink hover:bg-ink/[0.1]";
const SUMMARY = "w-fit cursor-pointer list-none rounded-sm [&::-webkit-details-marker]:hidden hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";

export function ChatErrorCard({ tone = "danger", title, details, detailsLabel, children, actions, onDismiss, className = "" }: {
  tone?: "danger" | "warning";
  title: ReactNode;
  /** The words behind a plain title, one click away. */
  details?: string | null;
  detailsLabel?: string;
  children?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} data-chat-error="" className={`${CARD} ${className}`}>
      <NoticeGlyph tone={tone} />
      <div className="min-w-0 flex-1 break-words">
        <span className="block font-medium">{title}</span>
        {details && <details className="text-ink-secondary"><summary className={SUMMARY}>{detailsLabel ?? t("chat.error.details")}</summary><p dir="auto" className="mt-0.5 break-words">{details}</p></details>}
        {children}
        {actions && <div className="mt-2 flex flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("chat.error.dismiss")}
          title={t("chat.error.dismiss")}
          className="-my-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink/68 hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus pointer-coarse:size-11 pointer-coarse:-my-2.5"
        >
          <GrokIcon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

export function ChatErrorBanner({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  const plain = plainErrorLine(message);
  return (
    <div className="mb-2 w-full px-5">
      <ChatErrorCard title={plain ?? message} details={plain ? message : null} onDismiss={onDismiss} />
    </div>
  );
}
