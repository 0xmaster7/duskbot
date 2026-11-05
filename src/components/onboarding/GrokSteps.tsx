import type { CSSProperties, ReactNode } from "react";
import { MausAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { productName } from "@/lib/brand";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { PILL } from "./SignInPill";
import "../../styles/onboarding.css";

/** The heading every first-run screen opens with, where Grok Bot puts it: 264px above the middle, 28/34 regular. */
export function StepHeading({ children }: { children: ReactNode }) {
  return (
    <h1 id="welcome-title" className="absolute left-1/2 top-[calc(50%-264px)] w-max max-w-[min(380px,calc(100%-32px))] -translate-x-1/2 text-center text-[28px] font-normal leading-[34px] tracking-[-0.02em] text-ink">
      {children}
    </h1>
  );
}

/** Next, and Back under it from the second screen on: two 288px pills 200px below the middle, 12px apart. */
export function StepFooter({ onNext, onBack }: { onNext: () => void; onBack?: () => void }) {
  return (
    <div className="absolute left-1/2 top-[calc(50%+200px)] flex w-[288px] max-w-[calc(100%-32px)] -translate-x-1/2 flex-col items-center gap-3">
      <button type="button" data-primary="" onClick={onNext} className={PILL}>{t("onboarding.meet.next")}</button>
      {onBack && (
        <button type="button" onClick={onBack} className="ui-button ui-button-pill ui-button-lg w-[288px] max-w-full border-transparent! bg-ink/6! text-ink hover:bg-ink/10!">
          {t("onboarding.step.back")}
        </button>
      )}
    </div>
  );
}

/** A plain window on the bot's desktop: a grey title bar with its three lights, on a light grey body. */
function SceneWindow({ className, lights, bar, children }: { className: string; lights: number; bar: number; children: ReactNode }) {
  return (
    <div className={cn("absolute overflow-hidden rounded-[8.3px] bg-[#f2f2f4] shadow-[0_12px_30px_rgb(0_0_0/0.12),0_4.5px_10.5px_rgb(0_0_0/0.05)]", className)}>
      <div className="absolute inset-x-px top-px bg-[#d9d9d9]" style={{ height: bar }} />
      <div className="absolute flex" style={{ left: lights + 2, top: (bar - lights) / 2 + 1, gap: lights * 0.6 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((light) => <span key={light} className="rounded-full" style={{ width: lights, height: lights, background: light }} />)}
      </div>
      {children}
    </div>
  );
}

/** Screen 2: the bot at work on its own computer: it thinks, opens a window, tries each tile, opens a form and presses
 * its button. */
export function ComputerStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="onboarding-step-in relative h-full min-h-[600px] w-full">
      <StepHeading>{t("onboarding.computer.title", { app: productName() })}</StepHeading>
      <div aria-hidden="true" className="onboarding-scene absolute left-1/2 top-[calc(50%-170.5px)] h-[300px] w-[441px] max-w-[calc(100%-32px)] -translate-x-1/2 overflow-hidden rounded-[16.59px] bg-[#90c5fd] shadow-[0_15.8px_44.24px_rgb(0_0_0/0.22)]">
        <div className="scene-wallpaper absolute inset-px rounded-[15.6px] bg-[radial-gradient(130%_95%_at_22%_-8%,#f7faff_0%,#dcebff_30%,rgb(220_235_255/0)_58%),radial-gradient(90%_80%_at_70%_120%,#5aa4fb_0%,rgb(90_164_251/0)_70%),linear-gradient(160deg,#b9d9ff_0%,#7ab7fd_55%,#8cc2ff_100%)]" />
        <SceneWindow className="scene-window-1 left-[51px] top-[46px] h-[158px] w-[258px]" lights={6} bar={21}>
          {[13, 72, 133, 194].map((left, index) => (
            <div key={left} className={`scene-tile scene-tile-${index + 1} absolute top-[29px] h-[38px] w-[51px] rounded-[5.5px] bg-white`} style={{ left }} />
          ))}
          <div className="absolute left-[13px] top-[78px] h-[88px] w-[234px] rounded-[5.5px] bg-white" />
        </SceneWindow>
        <SceneWindow className="scene-window-2 left-[126px] top-[74px] h-[184px] w-[263px]" lights={7} bar={25}>
          <div className="absolute left-[7px] top-[40px] h-[146px] w-[69px] rounded-[5.3px] bg-white" />
          <div className="absolute left-[83px] top-[40px] h-[145px] w-[180px] rounded-[5.5px] bg-white" />
          <div className="absolute left-[101px] top-[58px] size-[17px] rounded-[2.8px] bg-black/10" />
          <div className="absolute left-[101px] top-[91px] size-[17px] rounded-[2.8px] bg-black/10" />
          <div className="absolute left-[132px] top-[64px] h-[7px] w-[90px] rounded-full bg-black/10" />
          <div className="absolute left-[132px] top-[88px] h-[7px] w-[90px] rounded-full bg-black/10" />
          <div className="absolute left-[132px] top-[104px] h-[7px] w-[58px] rounded-full bg-black/10" />
          <div className="scene-button absolute left-[97px] top-[127px] h-[44px] w-[152px] rounded-[5.5px] bg-[rgb(4_4_4/0.12)]" />
        </SceneWindow>
        <div className="scene-bot absolute -left-0.5 -top-0.5 size-7">
          <svg viewBox="0 0 12 14" className="absolute -left-2.5 -top-2.5 h-[14px] w-3 drop-shadow-[0_1px_1px_rgb(0_0_0/0.2)]">
            <path d="M1 1 L1 12 L4 9 L6.5 13.5 L8.2 12.6 L5.8 8.3 L10 8.3 Z" fill="#1c1c1c" stroke="#fff" strokeWidth="0.9" strokeLinejoin="round" />
          </svg>
          <span className="scene-face absolute inset-0 flex"><MausAvatar color="chrome" bodyId="blob" size={28} trackPointer={false} /></span>
          <span className="scene-thinking onboarding-dots absolute inset-0 flex items-center justify-center gap-[3px]">
            <span className="size-[5px] rounded-full bg-[#1c1c1c]" /><span className="size-[7px] rounded-full bg-[#1c1c1c]" /><span className="size-[5px] rounded-full bg-[#1c1c1c]" />
          </span>
        </div>
      </div>
      <StepFooter onNext={onNext} onBack={onBack} />
    </div>
  );
}

/** Grok Bot's three Bots, where each lands and the job under it; they spread out of the one bot of the screen before. */
const JOBS = [
  { job: "onboarding.jobs.invoices", color: "red", x: -0.5, y: -112, chip: 143 },
  { job: "onboarding.jobs.standup", color: "teal", x: -132.5, y: 27, chip: 156 },
  { job: "onboarding.jobs.forecast", color: "blue", x: 137.5, y: 7, chip: 142 },
] as const satisfies readonly { job: LocaleKey; color: string; x: number; y: number; chip: number }[];
const JOBS_CENTER_Y = -19.5;

/** Screen 3: the bot becomes three, each with a job of its own. */
export function JobsStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="onboarding-step-in onboarding-jobs relative h-full min-h-[600px] w-full">
      <StepHeading>{t("onboarding.jobs.title")}</StepHeading>
      <div aria-hidden="true" className="absolute left-1/2 top-1/2">
        <span className="jobs-hero absolute -ml-8 -mt-8 flex" style={{ top: JOBS_CENTER_Y }}>
          <MausAvatar color="chrome" bodyId="blob" size={64} trackPointer={false} />
        </span>
        {JOBS.map((bot, index) => (
          <span key={bot.job} className="absolute" style={{ left: bot.x, top: bot.y }}>
            <span className="jobs-bot absolute -ml-9 -mt-9 flex"
              style={{ "--from-x": `${-bot.x}px`, "--from-y": `${JOBS_CENTER_Y - bot.y}px`, animationDelay: `${650 + index * 60}ms` } as CSSProperties}>
              <MausAvatar color={bot.color} bodyId="blob" size={72} state="happy" trackPointer={false} />
            </span>
          </span>
        ))}
      </div>
      <ul className="absolute left-1/2 top-1/2 m-0 list-none p-0">
        {JOBS.map((bot, index) => (
          <li key={bot.job} className="jobs-chip absolute flex h-[38px] -translate-x-1/2 items-center whitespace-nowrap rounded-[18px] bg-ink/6 px-[14px] text-[17px] font-medium leading-[22px] text-ink"
            style={{ left: bot.x, top: bot.y + 51, minWidth: bot.chip, justifyContent: "center", animationDelay: `${1450 + index * 90}ms` }}>
            {t(bot.job)}
          </li>
        ))}
      </ul>
      <StepFooter onNext={onNext} onBack={onBack} />
    </div>
  );
}
