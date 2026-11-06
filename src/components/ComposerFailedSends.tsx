// Messages that did not send, above the composer (Composer.tsx): Retry, Edit to take one back into the field, or dismiss.
// Edit on a failed send is an idea from Threebot (MIT).
import { CircleAlert, X } from "lucide-react";

import type { FailedComposerSend } from "@/lib/drafts";
import { t } from "@/lib/i18n";

// one flat line, no tinted card: the red mark says what happened, small outlined pills say what to do
const ACTION = "h-6 shrink-0 rounded-full border border-[color:var(--composer-menu-line)] px-2.5 text-[12px] leading-4 font-medium text-ink hover:bg-ink/[0.035]";

export function ComposerFailedSends({ sends, onRetry, onEdit, onDismiss }: {
  sends: FailedComposerSend[];
  onRetry: (failed: FailedComposerSend) => void;
  onEdit: (failed: FailedComposerSend) => void;
  onDismiss: (failed: FailedComposerSend) => void;
}) {
  return sends.map((failed) => (
    <div
      key={failed.id}
      data-failed-send
      role="status"
      className="mb-1.5 flex min-h-8 items-center gap-1.5 ps-3 pe-1 text-[13px] leading-[18px]"
    >
      <CircleAlert size={14} strokeWidth={2} className="shrink-0 text-danger" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[color:var(--composer-muted)]">
        {t("composer.failed.notSent", { text: failed.text.trim() || t("composer.failed.attachment") })}
      </span>
      <button type="button" onClick={() => onRetry(failed)} className={ACTION}>
        {t("chat.retry")}
      </button>
      <button type="button" data-failed-edit onClick={() => onEdit(failed)} className={ACTION}>
        {t("composer.failed.edit")}
      </button>
      <button
        type="button"
        onClick={() => onDismiss(failed)}
        aria-label={t("composer.failed.dismissAria")}
        title={t("composer.failed.dismiss")}
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-[color:var(--composer-muted)] hover:bg-ink/[0.035] hover:text-ink"
      >
        <X size={13} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  ));
}
