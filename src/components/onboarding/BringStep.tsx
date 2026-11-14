// The first run's "bring what you already use", in two parts: what this Mac holds from other AI apps, all chosen and
// brought in on one press, with how it went said right here; and for AIs that live online (ChatGPT, Claude, Gemini,
// Grok), three steps around a prompt to copy now. Continue never waits on either.
import { useId, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Check, ChevronDown, CircleAlert, Copy } from "../../icons";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { copyNotesPrompt } from "@/lib/assistant-notes";
import { planCounts } from "@/lib/bot-move";
import { MAUS_COLOR_NAMES, type MausColor } from "@/lib/mascot";
import { NOTES_PROMPT } from "../../../shared/assistant-notes";
import type { BringRun, LocalFind } from "@/lib/first-run-import";
import { MausAvatar } from "../Avatar";
import { ClaudeMark, CodexMark, CursorMark, GeminiMark, GrokMark, HermesMark } from "../ProviderIcons";
import { OpenClawMark } from "../OpenClawMark";
import { PixelIcon } from "../ui/PixelIcon";
import { useMotionReduced } from "../ui/SheetMotion";
import { PRIMARY, QUIET, StepFrame } from "./FunnelSteps";

const listFormat = (parts: string[]) => new Intl.ListFormat(activeLocale(), { style: "long", type: "conjunction" }).format(parts);

/** The app's own mark, by the find's tool or app name; dusk bot's earlier self is its mascot. */
function FindMark({ find, size = 18 }: { find: LocalFind; size?: number }) {
  const name = `${find.source ?? ""} ${find.bots?.from.key ?? ""} ${find.app}`.toLowerCase();
  if (/claude/.test(name)) return <ClaudeMark size={size} />;
  if (/hermes/.test(name)) return <HermesMark size={size} />;
  if (/openclaw|clawdbot|moltbot|moldbot/.test(name)) return <OpenClawMark size={size} />;
  if (/gemini/.test(name)) return <GeminiMark size={size} />;
  if (/codex/.test(name)) return <CodexMark size={size} />;
  if (/cursor/.test(name)) return <CursorMark size={size} />;
  if (/dusk|openmausbot|opengrokbot/.test(name)) return <MausAvatar color="chrome" size={size + 4} trackPointer={false} animated={false} label="" />;
  return <PixelIcon name="laptop" size={size} />;
}

/** Each arriving bot as it will look here: its colour from the move, its name beside it. */
function arriving(find: LocalFind): { name: string; color: MausColor }[] {
  return (find.bots?.preview.plans ?? []).map((plan) => {
    const color = plan.document.package.agents[0]?.appearance?.color;
    return { name: plan.addedAs, color: (MAUS_COLOR_NAMES as readonly string[]).includes(color ?? "") ? color as MausColor : "chrome" };
  });
}

/** "2 bots, with their memory and skills" or "your instructions and skills": what comes, never how many of each. */
function shortLine(find: LocalFind): string {
  const counts = find.bots ? planCounts(find.bots) : null;
  const kinds = [
    ...(counts && (counts.memories || counts.facts) ? [t("bring.kindMemory")] : []),
    // standing instructions (CLAUDE.md and the like) are the person's notes and preferences
    ...(find.setup?.instructions ? [t("bring.kindInstructions"), t("bring.kindPreferences")] : []),
    ...((counts?.skills || find.setup?.skills) ? [t("bring.kindSkills")] : []),
    ...(counts?.routines ? [t("bring.kindRoutines")] : []),
    ...(find.setup?.tools ? [t("bring.kindTools")] : []),
  ];
  if (!counts?.bots) return kinds.length ? t("bring.yours", { list: listFormat(kinds) }) : find.summary;
  const bots = counts.bots === 1 ? t("botMove.botsOne") : t("botMove.bots", { count: counts.bots });
  if (!kinds.length) return bots;
  return t(counts.bots === 1 ? "bring.botWith" : "bring.botsWith", { bots, list: listFormat(kinds) });
}

/** A light switch drawn inside the row, which is the real control. */
function RowSwitch({ on, locked }: { on: boolean; locked: boolean }) {
  return (
    <span aria-hidden="true" className={cn("relative inline-flex h-[18px] w-[30px] shrink-0 rounded-full transition-[background-color,opacity] duration-200 ease-[ease] motion-reduce:transition-none",
      on ? "bg-accent" : "bg-ink/[0.1]", locked && "opacity-50")}>
      <span className={cn("absolute left-[2px] top-[2px] size-[14px] rounded-full bg-white shadow-[0_1px_2px_0_rgb(28_28_28/0.14)] [transition:translate_220ms_var(--dusk-ease-out)] motion-reduce:transition-none",
        on && "translate-x-3")} />
    </span>
  );
}

function FindRow({ find, on, locked, onToggle }: { find: LocalFind; on: boolean; locked: boolean; onToggle: () => void }) {
  const bots = arriving(find);
  const shown = bots.slice(0, 4);
  return (
    <li>
      <button type="button" role="checkbox" aria-checked={on} aria-disabled={locked || undefined} data-bring-find={find.id} onClick={locked ? undefined : onToggle}
        className={cn("group flex w-full min-w-0 items-center gap-3 rounded-[14px] px-3 py-2.5 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          !locked && "transition-[background-color,transform] duration-150 ease-[ease] hover:bg-ink/[0.04] active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100")}>
        <span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center rounded-[11px] bg-app transition-opacity duration-200 ease-[ease] motion-reduce:transition-none", !on && "opacity-50")}>
          <FindMark find={find} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("truncate text-[14px] font-medium leading-5 transition-colors duration-200 ease-[ease]", on ? "text-ink" : "text-ink-tertiary")}>{find.app}</span>
          <span className="truncate text-[12px] leading-4 text-ink-tertiary">{shortLine(find)}</span>
          {shown.length > 0 && (
            <span data-bring-bots="" className={cn("mt-1 flex min-w-0 flex-wrap gap-1 transition-opacity duration-200 ease-[ease] motion-reduce:transition-none", !on && "opacity-50")}>
              {shown.map((bot) => (
                <span key={bot.name} className="inline-flex max-w-[150px] items-center gap-1 rounded-full bg-app py-0.5 pe-2 ps-0.5 text-[12px] leading-4 text-ink-secondary">
                  <MausAvatar color={bot.color} size={16} trackPointer={false} animated={false} label="" />
                  <span className="truncate">{bot.name}</span>
                </span>
              ))}
              {bots.length > shown.length && <span className="inline-flex items-center px-1 text-[12px] leading-4 text-ink-tertiary">+{bots.length - shown.length}</span>}
            </span>
          )}
        </span>
        <RowSwitch on={on} locked={locked} />
      </button>
    </li>
  );
}

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

/** One of the three steps, its number on a soft tonal disc. */
function How({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-ink/[0.06] text-[12px] font-medium leading-4 tabular-nums text-ink-secondary">{n}</span>
      <span className="min-w-0 pt-[3px] text-pretty text-[13px] leading-[18px] text-ink-secondary">{children}</span>
    </li>
  );
}

/** How the bringing in is going, under what was chosen: a slow breath while it works, then what came in. */
function RunLine({ run }: { run: BringRun }) {
  if (run.kind === "idle") return null;
  const failed = run.kind === "done" && run.failed;
  return (
    <p role="status" aria-live="polite" data-bring-run={run.kind} className="place-reveal m-0 mt-3 flex items-start gap-2 px-1 text-start text-[13px] leading-[18px] text-ink-secondary">
      {run.kind === "working"
        ? <span aria-hidden="true" className="funnel-wait mt-[6px] inline-block size-1.5 shrink-0 rounded-full bg-ink/60" />
        : failed
          ? <CircleAlert size={15} aria-hidden="true" className="mt-px shrink-0 text-ink-secondary" />
          : <Check size={15} aria-hidden="true" className="mt-px shrink-0 text-ink" />}
      <span className="min-w-0 text-pretty">{run.kind === "working" ? t("bring.working") : run.line}</span>
    </p>
  );
}

export function BringStep({ finds, grokWaiting, run = { kind: "idle" }, onBring, onNext }: {
  /** null while still looking. Extras are never rows: they come in with whatever is chosen. */
  finds: readonly LocalFind[] | null;
  /** Grok Bot's bots on this computer, by name: they move through the prompt, like an AI online. */
  grokWaiting: readonly string[];
  /** The bringing in, once started (useBringRun). */
  run?: BringRun;
  onBring: (chosen: LocalFind[]) => void;
  onNext: () => void;
}) {
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const [open, setOpen] = useState(false);
  // with things found here the prompt for AIs online is one quiet line until asked for
  const [onlineOpen, setOnlineOpen] = useState(false);
  const started = run.kind !== "idle";
  const promptId = useId();
  // Claude first, then the agent apps on this computer: the order localFinds gave
  const rows = (finds ?? []).filter((find) => !find.extra);
  const extras = (finds ?? []).filter((find) => find.extra);
  const chosen = rows.filter((find) => !off.has(find.id));
  const found = rows.length > 0;
  const showOnline = !found || onlineOpen;
  const toggle = (id: string) => setOff((was) => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const copyPrompt = async () => setCopy((await copyNotesPrompt()) ? "copied" : "failed");

  const label = "mb-2 flex items-center gap-2 px-1 text-start text-[12px] leading-4 text-ink-tertiary";

  const steps = (
    <div className="rounded-[18px] bg-ink/[0.035] p-4">
      <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
        <How n={1}>{t("bring.howCopy")}</How>
        <How n={2}>{t("bring.howPaste")}</How>
        <How n={3}>{t("bring.howFile")}</How>
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 ps-9">
        <button type="button" data-bring-copy="" onClick={() => void copyPrompt()}
          className="ui-button ui-button-pill min-h-9 gap-1.5 px-3.5 text-[13px] transition-[background-color,transform] duration-150 ease-[ease] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none motion-reduce:active:scale-100">
          {copy === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{copy === "copied" ? t("bring.copiedShort") : t("bring.copyPrimary")}</span>
        </button>
        <button type="button" data-bring-see="" aria-expanded={open} aria-controls={`${promptId}-text`} onClick={() => setOpen((was) => !was)}
          className="flex min-h-9 items-center gap-1 rounded-full px-2.5 text-[13px] leading-[18px] text-ink-tertiary transition-colors duration-150 ease-[ease] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
          <span>{open ? t("bring.hidePrompt") : t("bring.seePrompt")}</span>
          <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform duration-200 ease-[var(--dusk-ease-out)] motion-reduce:transition-none", open && "rotate-180")} />
        </button>
      </div>
      {copy !== "idle" && (
        <p role="status" data-bring-copied={copy} className={cn("place-reveal mb-0 mt-2 ps-9 text-pretty text-[12px] leading-4", copy === "failed" ? "text-danger" : "text-ink-tertiary")}>
          {copy === "failed" ? t("bring.copyFailed") : t("bring.copied")}
        </p>
      )}
      <div id={`${promptId}-text`} inert={!open} className={cn("grid transition-[grid-template-rows,opacity] duration-[240ms] ease-[var(--dusk-ease-out)] motion-reduce:transition-none", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="min-h-0 overflow-hidden">
          <pre tabIndex={open ? 0 : -1} aria-label={t("bring.promptLabel")}
            className="m-0 mt-3 max-h-[200px] overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-[12px] bg-app px-3.5 py-3 font-mono text-[12px] leading-[18px] text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {NOTES_PROMPT}
          </pre>
        </div>
      </div>
      {grokWaiting.length > 0 && (
        <p data-bring-grok="" className="mb-0 mt-3 ps-9 text-pretty text-[12px] leading-4 text-ink-tertiary">
          {t("bring.grokLine", { names: listFormat([...grokWaiting]) })}{" "}
          <button type="button" data-bring-grok-copy="" onClick={() => void copyPrompt()} className="rounded text-ink-secondary underline decoration-ink/25 underline-offset-2 hover:text-ink hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">{t("bring.grokCopy")}</button>
        </p>
      )}
    </div>
  );

  const online = (
    <section data-bring-prompt="" aria-labelledby={`${promptId}-label`} className={cn("w-full text-start", found && "mt-5")}>
      {found ? (
        <h2 className="m-0">
          <button type="button" id={`${promptId}-label`} data-bring-online="" aria-expanded={onlineOpen} aria-controls={`${promptId}-steps`} onClick={() => setOnlineOpen((was) => !was)}
            className="flex min-h-9 w-full items-center gap-1 rounded-full px-1 text-start text-[12px] font-normal leading-4 text-ink-tertiary transition-colors duration-150 ease-[ease] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
            <span className="min-w-0">{t("bring.onlineLabel")}</span>
            <ChevronDown size={14} aria-hidden="true" className={cn("shrink-0 transition-transform duration-200 ease-[var(--dusk-ease-out)] motion-reduce:transition-none", onlineOpen && "rotate-180")} />
          </button>
        </h2>
      ) : <h2 id={`${promptId}-label`} className="sr-only">{t("bring.onlineLabel")}</h2>}
      <div id={`${promptId}-steps`} inert={!showOnline} className={cn("grid transition-[grid-template-rows,opacity] duration-[240ms] ease-[var(--dusk-ease-out)] motion-reduce:transition-none", showOnline ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className={cn("min-h-0 overflow-hidden", found && "pt-1")}>{steps}</div>
      </div>
    </section>
  );

  return (
    <StepFrame art={<BringScene moving={run.kind === "working"} />} title={t("bring.title")} sub={found ? t("bring.sub") : t("bring.subNone")}
      footer={found && !started ? (
        <>
          <button type="button" data-primary="" data-bring-go="" autoFocus disabled={!chosen.length} onClick={() => onBring([...chosen, ...extras])} className={PRIMARY}>{t("bring.bring")}</button>
          <button type="button" data-bring-skip="" onClick={onNext} className={QUIET}>{t("funnel.skip")}</button>
        </>
      ) : (
        <button type="button" data-primary="" data-bring-next="" autoFocus={started} onClick={onNext} className={PRIMARY}>{t("funnel.next")}</button>
      )}>
      <div className="w-full max-w-[440px]">
        {finds === null && <p role="status" data-bring-looking="" className="mb-6 text-[13px] leading-[18px] text-ink-tertiary">{t("bring.looking")}</p>}
        {found && (
          <section aria-labelledby={`${promptId}-found`} className="w-full text-start">
            <h2 id={`${promptId}-found`} className={cn(label, "m-0 font-normal")}>{t("bring.foundLabel")}</h2>
            <ul aria-label={t("bring.foundLabel")} className="m-0 flex list-none flex-col gap-0.5 rounded-[18px] bg-ink/[0.035] p-1.5">
              {rows.map((find) => <FindRow key={find.id} find={find} on={!off.has(find.id)} locked={started} onToggle={() => toggle(find.id)} />)}
            </ul>
            <RunLine run={run} />
          </section>
        )}
        {finds !== null && online}
      </div>
    </StepFrame>
  );
}

/** The run's one quiet line at the foot of every step: bringing in, then what came in. */
export function BringStatus({ line, working }: { line: string | null; working: boolean }) {
  if (!line && !working) return null;
  return (
    <p role="status" aria-live="polite" data-bring-status={working ? "working" : "done"}
      className="pointer-events-none fixed inset-x-0 bottom-4 z-10 mx-auto flex w-fit max-w-[min(520px,calc(100%-32px))] items-center gap-2 rounded-[14px] bg-ink/[0.05] px-3 py-1.5 text-[12px] leading-4 text-ink-secondary">
      {working && <span aria-hidden="true" className="funnel-wait inline-block size-1.5 shrink-0 rounded-full bg-ink" />}
      <span className="text-pretty">{working ? t("bring.working") : line}</span>
    </p>
  );
}
