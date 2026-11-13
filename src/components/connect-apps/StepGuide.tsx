import type { ReactNode } from "react";

import { Icon } from "../Icon";

export interface GuideStep {
  key: string;
  /** One short line: what to do. */
  text: string;
  done?: boolean;
  /** The button, link or field that does it. */
  action?: ReactNode;
  /** Data attributes a caller marks the step with. */
  attrs?: Record<`data-${string}`, string>;
}

/** Numbered steps, each one plain line with the one thing to click or type under it. The first step not done is the
 * current one; a finished guide ends on one line saying so. */
export function StepGuide({ steps, label, finished }: { steps: readonly GuideStep[]; label: string; finished?: string | null }) {
  const current = steps.findIndex((step) => !step.done);
  return (
    <div className="ca-guide" data-step-guide="">
      <ol className="ca-guide-steps" aria-label={label}>
        {steps.map((step, index) => {
          const state = step.done ? "done" : index === current ? "current" : "next";
          return (
            <li key={step.key} {...step.attrs} className="ca-guide-step" data-guide-step={step.key} data-state={state} aria-current={state === "current" ? "step" : undefined}>
              <span className="ca-guide-number" aria-hidden="true">{step.done ? <Icon name="check" size={11} /> : index + 1}</span>
              <span className="ca-guide-body">
                <span className="ca-guide-text">{step.text}</span>
                {state !== "done" && step.action && <span className="ca-guide-action">{step.action}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {finished && (
        <p className="ca-guide-finished" role="status" data-guide-finished="">
          <Icon name="check" size={13} />
          <span>{finished}</span>
        </p>
      )}
    </div>
  );
}
