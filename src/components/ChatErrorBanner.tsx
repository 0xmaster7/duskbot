import { X } from "lucide-react";
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

export function ChatErrorBanner({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  const plain = plainErrorLine(message);
  return (
    <div className="w-full px-5">
      <div role="alert" data-chat-error="" className={`mb-2 ${NOTICE_LINE} text-danger`}>
        <div className="min-w-0 flex-1 break-words">
          <p>{plain ?? message}</p>
          {plain && <details className="mt-0.5 text-ink-tertiary"><summary className="w-fit cursor-pointer list-none rounded-sm [&::-webkit-details-marker]:hidden hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">{t("chat.error.details")}</summary><p dir="auto" className="mt-0.5 break-words text-ink-secondary">{message}</p></details>}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("chat.error.dismiss")}
          title={t("chat.error.dismiss")}
          className="-my-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-ink/[0.06] hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:size-9 pointer-coarse:-my-2.5"
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
