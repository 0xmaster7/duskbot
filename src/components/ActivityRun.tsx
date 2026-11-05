import { useEffect, useState } from "react";
import { ChevronRight, Check } from "lucide-react";
import type { Message } from "@/state/store";
import { describeRun } from "@/lib/activity-runs";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { toolStepLabel } from "@/lib/tool-step-label";

/** A finished run of tool steps reads as one quiet line, the way the bot's working line did, not as a button. */
export const RUN_TOGGLE = "-ms-2 flex min-w-0 max-w-full items-center gap-1.5 rounded-[10px] px-2 py-1 text-[13px] text-ink-tertiary transition-colors duration-[120ms] hover:bg-ink/[0.045] hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

export function ActivityRun({
  messages,
  forceOpen = false,
  children,
}: {
  messages: Message[];
  forceOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(forceOpen);
  const advanced = useAdvancedMode();
  const summary = advanced ? describeRun(messages) : describeRun(messages, toolStepLabel);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  if (open) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex min-w-0 justify-start">
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-expanded
            data-run-toggle=""
            className={RUN_TOGGLE}
          >
            <ChevronRight size={13} className="shrink-0 rotate-90" />
            <span className="min-w-0 truncate leading-5">{summary}</span>
          </button>
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className="flex min-w-0 justify-start">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        title={t("chat.run.showSteps")}
        data-run-toggle=""
            className={RUN_TOGGLE}
      >
        <Check size={13} aria-hidden="true" className="shrink-0 text-success" />
        <span className="min-w-0 max-w-[480px] truncate leading-5">{summary}</span>
        <ChevronRight size={13} className="shrink-0" />
      </button>
    </div>
  );
}
