import type { ReactNode } from "react";
import { CircleAlert, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { plainErrorLine } from "@/lib/plain-error";
import type { AppState } from "@/state/store";

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
const CARD = "flex items-start gap-3 rounded-[18px] border border-ink/[0.12] bg-composer p-3 text-[14px] leading-5 text-ink";
export const CARD_ACTION = "ui-button ui-button-pill border-transparent bg-ink/[0.06] text-ink hover:bg-ink/[0.1]";
const SUMMARY = "w-fit cursor-pointer list-none rounded-sm [&::-webkit-details-marker]:hidden hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

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
      <CircleAlert size={20} aria-hidden="true" fill="currentColor" className={`shrink-0 [&_line]:stroke-composer ${tone === "danger" ? "text-danger" : "text-warning"}`} />
      <div className="min-w-0 flex-1 break-words">
        <span className="block font-medium">{title}</span>
        {details && <details className="text-ink-secondary"><summary className={SUMMARY}>{detailsLabel ?? t("chat.error.details")}</summary><p dir="auto" className="mt-0.5 break-words">{details}</p></details>}
        {children}
        {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("chat.error.dismiss")}
          title={t("chat.error.dismiss")}
          className="-my-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-ink/[0.06] hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:size-11 pointer-coarse:-my-2.5"
        >
          <X size={16} aria-hidden="true" />
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
