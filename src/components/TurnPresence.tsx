import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { EASE_OUT, REDUCED } from "@/lib/motion-presets";
import { usePrefersReducedMotion } from "./mascot-clock";
import { cn } from "@/lib/cn";
import { WorkingTimer } from "@/components/WorkingIndicator";
import { phraseAt, phraseHoldMs } from "@/lib/live-activity";
import { quietText } from "@/lib/now-steps";
import { t } from "@/lib/i18n";
import { formatElapsed } from "@/lib/working-time";
import { isQuietPhase } from "@/lib/turn-tail";
import { LIFE_LATE_WORDS_MS, lifeDraw, lifeSpeaks } from "@/lib/reply-life";
import type { StepQuiet } from "../../shared/turn-progress";

const FADE_MS = 320;
/** Grok's activity line leaves in 140ms. */
const STATUS_EXIT_MS = 140;

export function useRotatingPhrase(
  phrases: readonly string[],
  phase: string,
  seed: string,
  active: boolean,
): { current: string; previous: string | null } {
  const phaseSeed = `${seed}|${phase}`;
  const [clock, setClock] = useState({ phaseSeed, step: 0 });
  if (clock.phaseSeed !== phaseSeed) setClock({ phaseSeed, step: 0 });
  const step = clock.phaseSeed === phaseSeed ? clock.step : 0;
  const [previous, setPrevious] = useState<string | null>(null);
  const current = phraseAt(phrases, phaseSeed, step);
  const shown = useRef(current);

  useEffect(() => {
    if (!active || phrases.length < 2) return;
    const timer = setTimeout(() => setClock({ phaseSeed, step: step + 1 }), phraseHoldMs(phaseSeed, step));
    return () => clearTimeout(timer);
  }, [active, phrases.length, phaseSeed, step]);

  useEffect(() => {
    if (shown.current === current) return;
    setPrevious(shown.current);
    shown.current = current;
    const timer = setTimeout(() => setPrevious(null), FADE_MS);
    return () => clearTimeout(timer);
  }, [current]);

  return { current, previous };
}

const SHEEN_PERIOD_MS = 2000;

function ShimmerPhrase({ text, className }: { text: string; className?: string }) {
  const [delay] = useState(() => `-${Date.now() % SHEEN_PERIOD_MS}ms`);
  return (
    <span className={cn("thinking-shimmer [grid-area:1/1]", className)} style={{ "--sheen-period": `${SHEEN_PERIOD_MS}ms`, "--sheen-delay": delay } as CSSProperties}>
      {text}
      <span aria-hidden="true" className="thinking-sheen"><span data-text={text} /></span>
    </span>
  );
}

/** The status label rules: like grok, the mark comes alone first and its words follow after a short wait drawn per
 * turn (so it never feels timed), then each step shows one phrase and keeps it at least 800ms before the next. */
export const STATUS_QUIET_MS = { min: 900, max: 1600 } as const;
export const STATUS_HOLD_MS = 800;
const TYPING_PHASE = "friendly:chat.typing";

function quietFor(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return STATUS_QUIET_MS.min + ((hash >>> 0) % (STATUS_QUIET_MS.max - STATUS_QUIET_MS.min));
}

function drawn(phrases: readonly string[], seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return phrases[(hash >>> 0) % Math.max(1, phrases.length)] ?? "";
}

/** The step label the simple status line shows now, or null while the turn is still quiet. A `wordless` wait (about half
 * the quiet ones, lifeSpeaks) keeps to the mark alone unless it runs long. */
export function useStatusLabel(phrases: readonly string[] | null, phase: string, seed: string, since: number | null, active: boolean, wordless = false): { key: string; text: string } | null {
  const [, wake] = useState(0);
  const shown = useRef<{ key: string; text: string; at: number; leftAt?: number } | null>(null);
  const firstSeen = useRef<number | null>(null);
  const now = Date.now();
  if (!active) firstSeen.current = null;
  else firstSeen.current ??= now;
  const quietUntil = (since ?? firstSeen.current ?? now) + (wordless ? lifeDraw(seed, "late", LIFE_LATE_WORDS_MS) : quietFor(`${seed}|quiet`));
  let next: { key: string; text: string } | null = phrases && phrases.length > 0 && now >= quietUntil
    ? { key: phase, text: drawn(phrases, `${seed}|${phase}`) }
    : null;
  const held = shown.current;
  // "Typing…" outlasts the reply by 800ms: the words land, then the line moves on
  if (held && next?.key !== held.key) held.leftAt ??= now;
  else if (held) held.leftAt = undefined;
  const holdUntil = held ? Math.max(held.at, held.key === TYPING_PHASE ? held.leftAt ?? 0 : 0) + STATUS_HOLD_MS : 0;
  if (held && next?.key !== held.key && now < holdUntil) next = held;
  // one phrase per step: a re-render inside the same step keeps the words it already showed
  else if (held && next?.key === held.key) next = held;
  if (!next) shown.current = null;
  else if (next.key !== held?.key) shown.current = { ...next, at: now };
  const due = Math.min(...[quietUntil, holdUntil].filter((at) => at > now));
  useEffect(() => {
    if (!active || !Number.isFinite(due)) return;
    const timer = setTimeout(() => wake((tick) => tick + 1), due - Date.now());
    return () => clearTimeout(timer);
  }, [active, due]);
  return active && next ? { key: next.key, text: next.text } : null;
}

/** Grok's shimmer: the words in 40% ink with a full-ink band swept across them by background-position, 2.2s in 60
 * steps. */
function StatusShimmer({ text }: { text: string }) {
  return <span className="status-shimmer">{text}</span>;
}

/** One step's words crossfading with the next; the leaving words are no longer part of the line. */
function StepPhrase({ text, hover, reduced }: { text: string; hover?: string; reduced: boolean }) {
  const present = useIsPresent();
  return (
    <motion.span
      className={cn("flex min-w-0 items-center [grid-area:1/1]", !present && "turn-phrase-out")}
      title={hover}
      aria-hidden={present ? undefined : true}
      data-turn-now={present ? "" : undefined}
      initial={{ opacity: 0, y: reduced ? 0 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduced ? 0 : -4 }}
      transition={reduced ? REDUCED : { duration: 0.18, ease: EASE_OUT }}
    >
      <StatusShimmer text={text} />
    </motion.span>
  );
}

const NOTHING: readonly string[] = [];
// The spaces keep copied text readable; the flex gap does the spacing on screen.
const Dot = () => <span aria-hidden="true" className="text-[12px] text-ink-tertiary"> · </span>;

/** "last output 2 min ago" counts on by itself; the other states change only with a new frame. */
function QuietPart({ quiet }: { quiet: StepQuiet }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (quiet.kind !== "output") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [quiet]);
  return <><Dot /><span data-turn-quiet="" className="text-[12px] text-ink-tertiary">{quietText(quiet, now)}</span></>;
}

/** The turn's live status line: "Working · 1m 12s · Running scrape.py · busy, no output yet". The lead word and the
 * timer stay for the whole turn; `phrases` say what is happening now and rotate through their alternates; `size` is how
 * much of the file is written; `quiet` is how a long step is doing. With nothing to say the line is the lead and the timer
 * alone. The part that is live shimmers. `simple` draws Simple mode's quiet line instead: the avatar and one phrase for
 * what is happening now. With a `card`, the line is a button that unfolds it underneath. */
export function TurnPresence({
  avatar,
  visible,
  label,
  phrases,
  phase,
  seed = "",
  answering = false,
  since = null,
  size,
  simple = false,
  detail,
  hover,
  quiet,
  card,
  cardLabel,
  className,
}: {
  avatar: ReactNode;
  visible: boolean;
  label?: string;
  phrases?: readonly string[];
  phase?: string;
  seed?: string;
  answering?: boolean;
  since?: number | null;
  size?: string;
  simple?: boolean;
  /** Simple mode: Advanced's wording for what is happening now, kept in the row's tooltip with the timer and size. */
  detail?: string;
  /** The whole command, query or address behind the phrase. */
  hover?: string;
  quiet?: StepQuiet;
  card?: ReactNode;
  cardLabel?: string;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const [presencePhase, setPhase] = useState<"think" | "answer" | "out">(answering ? "answer" : "think");
  const [open, setOpen] = useState(false);
  const wasAnswering = useRef(answering);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const cardId = useId();
  const statusId = useId();

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setPhase(answering ? "answer" : "think");
      wasAnswering.current = answering;
      return;
    }
    if (!mounted) return;
    const handoff = wasAnswering.current;
    wasAnswering.current = false;
    if (handoff) {
      setMounted(false);
      return;
    }
    setPhase("out");
    const timer = setTimeout(() => setMounted(false), simple ? STATUS_EXIT_MS : 280);
    return () => clearTimeout(timer);
  }, [visible, answering, mounted, simple]);

  const showWorking = presencePhase === "think";
  // grok's line leaves with the words it was saying
  const simpleStatus = simple && (showWorking || presencePhase === "out");
  const expandable = Boolean(card) && showWorking;
  useEffect(() => {
    if (!expandable) setOpen(false);
  }, [expandable]);
  useEffect(() => {
    if (!open) return;
    const fold = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const inside = Boolean(root.current?.contains(document.activeElement));
      if (!inside && document.activeElement && document.activeElement !== document.body) return;
      event.preventDefault();
      setOpen(false);
      if (inside) toggle.current?.focus();
    };
    document.addEventListener("keydown", fold);
    return () => document.removeEventListener("keydown", fold);
  }, [open]);
  const lead = label ?? t("chat.activity.working");
  const now = phrases && phrases.length > 0 ? phrases : null;
  const { current, previous } = useRotatingPhrase(now ?? NOTHING, phase ?? now?.[0] ?? "", seed, !simple && mounted && showWorking && now !== null);
  const wordless = !label && isQuietPhase(phase) && !lifeSpeaks(seed);
  const step = useStatusLabel(label ? [label] : now, label ? `label:${label}` : phase ?? now?.[0] ?? "", seed, since, mounted && simpleStatus, wordless);
  if (!mounted) return null;
  const status = simpleStatus ? (
    <span id={statusId} className="turn-label-slot flex h-[22px] min-w-0 items-center gap-x-1.5 text-[14px] leading-[22px]" data-turn-status>
      <span className="grid min-w-0">
        <AnimatePresence initial={false}>
          {step && (
            <StepPhrase key={step.key} text={step.text} hover={hover} reduced={reduced} />
          )}
        </AnimatePresence>
      </span>
      {step && quiet && <QuietPart quiet={quiet} />}
    </span>
  ) : showWorking ? (
    <span id={statusId} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 leading-none" data-turn-status>
      {now ? <span className="text-[13px] text-ink-secondary">{lead}</span> : <ShimmerPhrase text={lead} className="text-[13px]" />}
      {since !== null && (
        <>
          <Dot />
          <WorkingTimer since={since} className="text-[12px] text-ink-tertiary" />
        </>
      )}
      {now && (
        <>
          <Dot />
          {/* One phrase at a time: a fading old phrase sat out of flow and a longer one drew over the size beside it. */}
          <span className="turn-phrase relative grid min-w-0 max-w-full text-[13px]" title={hover} data-turn-now>
            <ShimmerPhrase
              key={`in:${current}`}
              text={current}
              className={cn("truncate", previous !== null && "turn-phrase-in")}
            />
          </span>
          {size && (
            <>
              <Dot />
              <span className="text-[12px] tabular-nums text-ink-tertiary" data-turn-size>{size}</span>
            </>
          )}
          {quiet && <QuietPart quiet={quiet} />}
        </>
      )}
    </span>
  ) : null;
  return (
    <div ref={root} className={cn("turn-presence flex min-w-0 max-w-full flex-col items-start", className)}>
      <div
        title={simple && showWorking ? [lead, since !== null ? formatElapsed(Date.now() - since) : null, detail ?? (now ? current : null), size].filter(Boolean).join(" · ") : undefined}
        className={cn(
          simple ? "flex h-9 min-w-0 max-w-full items-center gap-[8.5px] ps-2" : "flex min-w-0 max-w-full items-center gap-2",
          presencePhase === "think" && (simple ? "turn-status-in" : "turn-mascot-in"),
          presencePhase === "out" && (simple ? "turn-status-out" : "turn-mascot-out"),
        )}
      >
        {simple ? <span className="turn-status-mark inline-flex shrink-0">{avatar}</span> : avatar}
        {expandable && (!simple || step) ? (
          <button
            ref={toggle}
            type="button"
            aria-expanded={open}
            aria-controls={cardId}
            aria-label={cardLabel}
            aria-describedby={statusId}
            onClick={() => setOpen((shown) => !shown)}
            className="turn-now-toggle"
          >
            {status}
            <ChevronDown aria-hidden="true" size={12} strokeWidth={2} className={cn("turn-now-chevron", open && "rotate-180")} />
          </button>
        ) : status}
      </div>
      {expandable && (!simple || step) && open && (
        <div id={cardId} role="region" aria-label={cardLabel} className="turn-now-card">
          {card}
        </div>
      )}
    </div>
  );
}
