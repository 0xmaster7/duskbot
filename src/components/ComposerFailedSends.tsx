// Messages that did not send, above the composer (Composer.tsx): Retry, Edit to take one back into the field, or dismiss.
// Edit on a failed send is an idea from Threebot (MIT).
import type { FailedComposerSend } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import { CARD_ACTION, ChatErrorCard } from "./ChatErrorBanner";

/** Each send that failed is grok's card above the composer, like a reply that never came; never a tinted strip. */
export function ComposerFailedSends({ sends, onRetry, onEdit, onDismiss }: {
  sends: FailedComposerSend[];
  onRetry: (failed: FailedComposerSend) => void;
  onEdit: (failed: FailedComposerSend) => void;
  onDismiss: (failed: FailedComposerSend) => void;
}) {
  return sends.map((failed) => (
    <div key={failed.id} data-failed-send="" className="mb-2">
      <ChatErrorCard
        title={<span className="block truncate">{t("composer.failed.notSent", { text: failed.text.trim() || t("composer.failed.attachment") })}</span>}
        onDismiss={() => onDismiss(failed)}
        actions={<>
          <button type="button" onClick={() => onRetry(failed)} className={CARD_ACTION}>{t("chat.retry")}</button>
          <button type="button" data-failed-edit onClick={() => onEdit(failed)} className={CARD_ACTION}>{t("composer.failed.edit")}</button>
        </>}
      />
    </div>
  ));
}
