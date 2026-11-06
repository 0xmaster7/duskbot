import { RefreshCw } from "lucide-react";
import { t } from "@/lib/i18n";
import { CARD_ACTION, ChatErrorCard } from "./ChatErrorBanner";

/** A turn whose reply came back but a step it ran failed or wasn't allowed: done in part, not broken. The step's
 * own row still shows its error; the cause stays one click away. */
export function PartlyDoneRow({ cause, onRetry }: { cause: string; onRetry?: () => void }) {
  return (
    <div className="flex justify-start">
      <ChatErrorCard
        tone="warning"
        className="w-fit max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct))]"
        title={t("chat.error.partial")}
        details={cause}
        actions={onRetry && (
          <button type="button" onClick={onRetry} className={CARD_ACTION}>
            <RefreshCw size={14} aria-hidden="true" /> {t("chat.retry")}
          </button>
        )}
      />
    </div>
  );
}
