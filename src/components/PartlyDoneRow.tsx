import { RefreshCw } from "lucide-react";
import { t } from "@/lib/i18n";
import { NOTE_ACTION, TranscriptNote } from "./TranscriptNote";

/** A turn whose reply came back but a step it ran failed or wasn't allowed: done in part, not broken. The step's
 * own row still shows its error; the cause stays one click away. */
export function PartlyDoneRow({ cause, onRetry }: { cause: string; onRetry?: () => void }) {
  return (
    <TranscriptNote
      warning
      text={t("chat.error.partial")}
      details={cause}
      actions={onRetry && (
        <button type="button" onClick={onRetry} className={NOTE_ACTION}>
          <RefreshCw size={12} aria-hidden="true" /> {t("chat.retry")}
        </button>
      )}
    />
  );
}
