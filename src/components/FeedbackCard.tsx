import { useEffect, useState } from "react";
import { Smile } from "../icons";
import { t } from "@/lib/i18n";
import { feedbackAnswered, feedbackDismissed, feedbackShown } from "@/lib/feedback-prompt";
import { NoticeCard } from "./NoticeCard";

const MOMENT = "regular_use";
const SCORE = "ui-button min-h-11 min-w-11 flex-1 px-0 font-medium tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** "how's it going?" once a regular stretch of use is behind someone: five taps, or close it */
export function FeedbackCard({ onDone }: { onDone: () => void }) {
  const [answered, setAnswered] = useState(false);
  useEffect(() => { feedbackShown(MOMENT); }, []);
  useEffect(() => {
    if (!answered) return;
    const timer = setTimeout(onDone, 2200);
    return () => clearTimeout(timer);
  }, [answered, onDone]);
  const dismiss = () => { if (!answered) feedbackDismissed(MOMENT); onDone(); };
  return <NoticeCard titleId="feedback-title" notice="feedback" icon={Smile} pixel="bubble" title={t(answered ? "feedback.thanks" : "feedback.title")} onDismiss={dismiss}>
    {!answered && <>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">{t("feedback.body")}</p>
      <div role="group" aria-labelledby="feedback-title" className="mt-3 flex gap-1.5">
        {[1, 2, 3, 4, 5].map(score => (
          <button key={score} type="button" aria-label={t("feedback.score", { score: String(score) })} className={SCORE}
            onClick={() => { feedbackAnswered(score, MOMENT); setAnswered(true); }}>{score}</button>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[12px] text-ink-secondary" aria-hidden="true"><span>{t("feedback.low")}</span><span>{t("feedback.high")}</span></div>
    </>}
  </NoticeCard>;
}
