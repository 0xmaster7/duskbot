// The first run's "bring what you already use": the shared bring in flow (BringIn) on its own step, with a still scene
// above it and the funnel's buttons below. Continue never waits on it.
import { type ReactNode } from "react";
import { motion } from "motion/react";
import { t } from "@/lib/i18n";
import type { BringRun, LocalFind } from "@/lib/first-run-import";
import { MausAvatar } from "../Avatar";
import { BringIn, useBringChoice } from "../BringIn";
import { ClaudeMark, CodexMark, GeminiMark, GrokMark } from "../ProviderIcons";
import { useMotionReduced } from "../ui/SheetMotion";
import { PRIMARY, QUIET, StepFrame } from "./FunnelSteps";

/** Logos of the AI apps the prompt is for, in small tiles. */
const ONLINE: { key: string; mark: (size: number) => ReactNode }[] = [
  { key: "chatgpt", mark: (size) => <CodexMark size={size} /> },
  { key: "claude", mark: (size) => <ClaudeMark size={size} /> },
  { key: "gemini", mark: (size) => <GeminiMark size={size} /> },
  { key: "grok", mark: (size) => <GrokMark size={size} /> },
];

const PACKETS = 3;
const PACKET_S = 2.8;
/** The track between the two ends: the scene's 248px less both 52px ends and their 8px gaps, less a packet. */
const TRACK_PX = 124;

/** Your other AI apps on the left, dusk bot on the right, in the canvas's own greys. Something travels between them only
 * while something is being brought in. */
function BringScene({ moving }: { moving: boolean }) {
  const reduced = useMotionReduced();
  return (
    <div data-bring-scene={moving ? "moving" : "still"} className="relative flex h-16 w-[248px] items-center justify-between">
      <span className="relative h-14 w-[52px] shrink-0 grayscale">
        {ONLINE.slice(0, 3).map((app, index) => (
          <span key={app.key} className="absolute grid size-7 place-items-center rounded-[9px] bg-ink/[0.06] opacity-80"
            style={{ left: index === 1 ? 22 : 0, top: index * 14 }}>{app.mark(15)}</span>
        ))}
      </span>
      <span className="relative mx-2 h-6 flex-1">
        <span className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between px-1">
          {Array.from({ length: 9 }, (_, index) => <span key={index} className="size-[3px] bg-ink/15" />)}
        </span>
        {moving && !reduced && Array.from({ length: PACKETS }, (_, index) => (
          <motion.span key={index} aria-hidden="true" className="absolute left-0 top-1/2 -mt-[2px] size-1 bg-ink/55 will-change-transform"
            initial={{ x: 0, opacity: 0 }} animate={{ x: [0, TRACK_PX], opacity: [0, 1, 1, 0] }}
            transition={{ duration: PACKET_S, ease: "linear", repeat: Infinity, delay: index * (PACKET_S / PACKETS), times: [0, 0.15, 0.85, 1] }} />
        ))}
      </span>
      <span className="shrink-0"><MausAvatar color="chrome" size={52} state="happy" trackPointer={false} animated={moving && !reduced} label="" /></span>
    </div>
  );
}

export function BringStep({ finds, grokWaiting, run = { kind: "idle" }, onBring, onNext }: {
  /** null while still looking. */
  finds: readonly LocalFind[] | null;
  /** Grok bot's bots on this computer, by name: they move through the prompt, like an AI online. */
  grokWaiting: readonly string[];
  /** The bringing in, once started (useBringRun). */
  run?: BringRun;
  onBring: (chosen: LocalFind[]) => void;
  onNext: () => void;
}) {
  const choice = useBringChoice(finds);
  const started = run.kind !== "idle";
  return (
    <StepFrame art={<BringScene moving={run.kind === "working"} />} title={t("bring.title")} sub={choice.found ? t("bring.sub") : t("bring.subNone")}
      footer={choice.found && !started ? (
        <>
          <button type="button" data-primary="" data-bring-go="" autoFocus disabled={!choice.chosen.length} onClick={() => onBring(choice.toBring)} className={PRIMARY}>{t("bring.bring")}</button>
          <button type="button" data-bring-skip="" onClick={onNext} className={QUIET}>{t("funnel.skip")}</button>
        </>
      ) : (
        <button type="button" data-primary="" data-bring-next="" autoFocus={started} onClick={onNext} className={PRIMARY}>{t("funnel.next")}</button>
      )}>
      <div className="w-full max-w-[440px]">
        <BringIn finds={finds} choice={choice} grokWaiting={grokWaiting} run={run} />
      </div>
    </StepFrame>
  );
}

/** The run's one quiet line at the foot of every step: bringing in, then what came in. */
export function BringStatus({ line, working }: { line: string | null; working: boolean }) {
  if (!line && !working) return null;
  return (
    <p role="status" aria-live="polite" data-bring-status={working ? "working" : "done"}
      className="pointer-events-none fixed right-0 bottom-4 left-[var(--rail-beside,0px)] z-10 mx-auto flex w-fit max-w-[min(520px,calc(100%-32px))] items-center gap-2 rounded-[14px] bg-ink/[0.05] px-3 py-1.5 text-[12px] leading-4 text-ink-secondary">
      {working && <span aria-hidden="true" className="funnel-wait inline-block size-1.5 shrink-0 rounded-full bg-ink" />}
      <span className="text-pretty">{working ? t("bring.working") : line}</span>
    </p>
  );
}
