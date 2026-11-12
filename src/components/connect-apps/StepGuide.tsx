import type { ReactNode } from "react";

import { MASCOT_INK } from "@/lib/mascot";
import { DuskMark } from "../mascot-view";
import { PixelIcon, type PixelIconName } from "../ui/PixelIcon";
import { Icon } from "../Icon";

export interface GuideStep {
  key: string;
  /** One short line: what to do. */
  text: string;
  /** The small picture that explains the step. */
  pixel: PixelIconName;
  done?: boolean;
  /** The button, link or field that does it. */
  action?: ReactNode;
  /** Data attributes a caller marks the step with. */
  attrs?: Record<`data-${string}`, string>;
}

// one mascot per step, so a guide reads as a little team walking you through it
const GUIDES: ReadonlyArray<{ body: string; colour: string }> = [
  { body: "kit", colour: MASCOT_INK.blue },
  { body: "pip", colour: MASCOT_INK.purple },
  { body: "mochi", colour: MASCOT_INK.pink },
  { body: "hop", colour: MASCOT_INK.green },
  { body: "puff", colour: MASCOT_INK.orange },
];

/** Numbered steps, each with its mascot, its picture, one line and the one thing to click or type. The first step not
 * done is the current one; a finished guide ends on a happy mascot. */
export function StepGuide({ steps, label, finished }: { steps: readonly GuideStep[]; label: string; finished?: string | null }) {
  const current = steps.findIndex((step) => !step.done);
  return (
    <div className="ca-guide" data-step-guide="">
      <ol className="ca-guide-steps" aria-label={label}>
        {steps.map((step, index) => {
          const state = step.done ? "done" : index === current ? "current" : "next";
          const guide = GUIDES[index % GUIDES.length]!;
          return (
            <li key={step.key} {...step.attrs} className="ca-guide-step" data-guide-step={step.key} data-state={state} aria-current={state === "current" ? "step" : undefined}>
              <span className="ca-guide-number" aria-hidden="true">{step.done ? <Icon name="check" size={11} /> : index + 1}</span>
              <span className="ca-guide-art" aria-hidden="true">
                <DuskMark body={guide.body} colour={guide.colour} state={step.done ? "happy" : "idle"} size={26} animated={state === "current"} label={null} />
                <PixelIcon name={step.pixel} size={18} />
              </span>
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
          <DuskMark body="kit" colour={MASCOT_INK.green} state="celebrate" size={34} label={null} />
          <span>{finished}</span>
        </p>
      )}
    </div>
  );
}
