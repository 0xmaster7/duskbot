import { RefreshCw } from "lucide-react";
import { t } from "@/lib/i18n";
import { NOTE_ACTION } from "./TranscriptNote";

/** A stopped turn, never an error: one quiet word, whoever stopped it. `name` is the row's tool name. */
export function CancelledTurnRow({ onRetry }: { onRetry?: () => void; name?: string }) {
  return (
    <div role="status" className="flex w-fit max-w-full flex-wrap items-center gap-2 text-[13px] text-ink-tertiary">
      <span>{t("chat.turnStopped")}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={NOTE_ACTION}
        >
          <RefreshCw size={12} /> {t("chat.retry")}
        </button>
      )}
    </div>
  );
}
