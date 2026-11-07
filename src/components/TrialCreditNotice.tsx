import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { NOTE_ACTION, TranscriptNote } from "./TranscriptNote";

/** A turn the trial credit could no longer pay for: a quiet line with the one way on, never an error in the chat. */
export function TrialCreditNotice({ kind }: { kind: "used_up" | "ended" }) {
  const { dispatch } = useStore();
  return (
    <TranscriptNote
      data-trial-credit-notice={kind}
      text={t(kind === "used_up" ? "engines.trialCreditUsedUp" : "engines.trialCreditEnded")}
      actions={(
        <button type="button" onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "engines" })} className={NOTE_ACTION}>
          {t("chat.error.connectOwnAi")}
        </button>
      )}
    />
  );
}
