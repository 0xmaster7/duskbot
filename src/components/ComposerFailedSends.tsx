// Messages that did not send, above the composer (Composer.tsx): Retry, Edit to take one back into the field, or dismiss.
// Edit on a failed send is an idea from Threebot (MIT).
import { X } from "lucide-react";

import type { FailedComposerSend } from "@/lib/drafts";
import { t } from "@/lib/i18n";

const ACTION = "shrink-0 rounded px-2 py-1 font-medium hover:bg-danger/10";

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
      className="mb-2 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger"
    >
      <span className="min-w-0 flex-1 truncate">
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
        className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-danger/10"
      >
        <X size={13} strokeWidth={2.5} />
      </button>
    </div>
  ));
}
