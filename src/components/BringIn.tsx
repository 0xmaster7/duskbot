// "Bring what you already use", the one flow for it: what this Mac holds from other AI apps, chosen and brought in on one
// press, with how it went said right here; and for AIs that live online (ChatGPT, Claude, Gemini, Grok), three steps
// around a prompt to copy, whose answer comes in when it is pasted or dropped here. The first run's bring step and
// Settings' import page both draw it; only what sits around it differs.
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, CircleAlert, Copy } from "../icons";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { copyNotesPrompt, looksLikeNotes, notesInFiles } from "@/lib/assistant-notes";
import { planCounts } from "@/lib/bot-move";
import { MAUS_COLOR_NAMES, type MausColor } from "@/lib/mascot";
import { NOTES_PROMPT } from "../../shared/assistant-notes";
import { broughtIds, type BringRun, type LocalFind } from "@/lib/first-run-import";
import { MausAvatar } from "./Avatar";
import { GrokBotMark } from "./GrokBotMark";
import { useNotesIntake, type NotesSay } from "./NotesWaiting";
import { ClaudeMark, CodexMark, CursorMark, GeminiMark, HermesMark } from "./ProviderIcons";
import { OpenClawMark } from "./OpenClawMark";
import { PixelIcon } from "./ui/PixelIcon";

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
  if (/grok/.test(name)) return <GrokBotMark size={size} />;
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

type RowState = "idle" | "working" | "done";

/** One app found here: its mark, what it holds, the bots arriving, and its own Import. */
function FindRow({ find, state, busy, onImport }: { find: LocalFind; state: RowState; busy: boolean; onImport: () => void }) {
  const bots = arriving(find);
  const shown = bots.slice(0, 4);
  return (
    <li data-bring-find={find.id} data-bring-state={state} className="flex min-w-0 items-center gap-3 rounded-[14px] px-3 py-2.5 text-start">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-app">
        <FindMark find={find} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-medium leading-5 text-ink">{find.app}</span>
        <span className="truncate text-[12px] leading-4 text-ink-tertiary">{shortLine(find)}</span>
        {shown.length > 0 && (
          <span data-bring-bots="" className="mt-1 flex min-w-0 flex-wrap gap-1">
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
      {state === "done" ? (
        <span data-bring-imported="" className="inline-flex min-h-9 shrink-0 items-center gap-1 px-2 text-[13px] leading-[18px] text-ink-secondary">
          <Check size={14} aria-hidden="true" />{t("bring.imported")}
        </span>
      ) : (
        <button type="button" data-bring-import={find.id} disabled={busy} onClick={onImport} aria-label={state === "working" ? undefined : t("bring.importApp", { app: find.app })}
          className="ui-button ui-button-pill min-h-9 shrink-0 gap-1.5 px-3.5 text-[13px] transition-[background-color,transform] duration-150 ease-[ease] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100">
          {state === "working" && <span aria-hidden="true" className="funnel-wait inline-block size-1.5 shrink-0 rounded-full bg-ink/60" />}
          {state === "working" ? t("bring.importing") : t("bring.import")}
        </button>
      )}
    </li>
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

/** A quiet status line: a slow breath while it works, then what came in, or what went wrong. */
function StatusLine({ state, line, ...rest }: { state: "working" | "done" | "failed"; line: string; "data-bring-run"?: string; "data-bring-notes"?: string }) {
  return (
    <p role="status" aria-live="polite" {...rest} className="place-reveal m-0 mt-3 flex items-start gap-2 px-1 text-start text-[13px] leading-[18px] text-ink-secondary">
      {state === "working"
        ? <span aria-hidden="true" className="funnel-wait mt-[6px] inline-block size-1.5 shrink-0 rounded-full bg-ink/60" />
        : state === "failed"
          ? <CircleAlert size={15} aria-hidden="true" className="mt-px shrink-0 text-ink-secondary" />
          : <Check size={15} aria-hidden="true" className="mt-px shrink-0 text-ink" />}
      <span className="min-w-0 text-pretty">{line}</span>
    </p>
  );
}

/** How the bringing in is going, under what was chosen. */
function RunLine({ run }: { run: BringRun }) {
  if (run.kind === "idle") return null;
  return <StatusLine data-bring-run={run.kind} state={run.kind === "working" ? "working" : run.failed ? "failed" : "done"} line={run.kind === "working" ? t("bring.working") : run.line} />;
}

/** What was found here, every app a row of its own (Claude first, then the agent apps: the order localFinds gave), and
 * what Import all brings in: each row not brought in yet. */
export function useBringChoice(finds: readonly LocalFind[] | null, run: BringRun = { kind: "idle" }) {
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  const brought = broughtIds(run);
  return useMemo(() => {
    const rows = finds ?? [];
    const extras: LocalFind[] = [];
    const chosen = rows.filter((find) => !off.has(find.id) && !brought.includes(find.id));
    const toggle = (id: string) => setOff((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    return { rows, off, chosen, toggle, found: rows.length > 0, toBring: [...chosen, ...extras] };
  }, [finds, off, brought]);
}
export type BringChoice = ReturnType<typeof useBringChoice>;

/** Notes from another AI, pasted or dropped while this is open, come in here and say how it went here. Nothing behind
 * sees them: the chat box would otherwise attach a dropped file, and one Send would hand it to its model. */
function useNotesHere(): { said: { line: string; state: "working" | "done" | "failed" } | null; over: boolean } {
  const takeNotes = useNotesIntake();
  const [said, setSaid] = useState<{ line: string; state: "working" | "done" | "failed" } | null>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const say: NotesSay = (line, state) => setSaid({ line, state });
    const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    let depth = 0;
    const paste = (event: ClipboardEvent) => {
      const pasted = event.clipboardData?.getData("text/plain") ?? "";
      if (!looksLikeNotes(pasted)) return;
      event.preventDefault();
      event.stopPropagation();
      takeNotes(pasted, say, "paste");
    };
    const hold = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.type === "dragenter") depth += 1;
      if (event.type === "dragleave") depth = Math.max(0, depth - 1);
      setOver(depth > 0);
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depth = 0;
      setOver(false);
      void notesInFiles(Array.from(event.dataTransfer?.files ?? [])).then((notes) => {
        if (notes) takeNotes(notes.text, say, "drop");
        else say(t("composer.notes.error.notExport"), "failed");
      });
    };
    const listeners = [["paste", paste], ["dragenter", hold], ["dragover", hold], ["dragleave", hold], ["drop", drop]] as const;
    for (const [type, listener] of listeners) window.addEventListener(type, listener as EventListener, true);
    return () => {
      for (const [type, listener] of listeners) window.removeEventListener(type, listener as EventListener, true);
    };
  }, [takeNotes]);
  return { said, over };
}

export function BringIn({ finds, choice, grokWaiting, run, bringButton = false, onBring, onImport }: {
  /** null while still looking. Extras are never rows: they come in with whatever is chosen. */
  finds: readonly LocalFind[] | null;
  choice: BringChoice;
  /** Grok bot's bots on this computer with nothing saved yet, by name: they move through the prompt, like an AI online. */
  grokWaiting: readonly string[];
  /** The bringing in, once started (useBringRun). */
  run: BringRun;
  /** Settings has no footer, so the press to bring the chosen in sits under the list. */
  bringButton?: boolean;
  onBring?: () => void;
  /** One app's own Import. */
  onImport?: (find: LocalFind) => void;
}) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const [open, setOpen] = useState(false);
  // with things found here the prompt for AIs online is one quiet line until asked for
  const [onlineOpen, setOnlineOpen] = useState(false);
  const notes = useNotesHere();
  const started = run.kind !== "idle";
  const promptId = useId();
  const { rows, chosen, found } = choice;
  const brought = broughtIds(run);
  const rowState = (find: LocalFind): RowState => brought.includes(find.id) ? "done" : run.kind === "working" && run.ids.includes(find.id) ? "working" : "idle";
  const showOnline = !found || onlineOpen;
  const copyPrompt = async () => setCopy((await copyNotesPrompt()) ? "copied" : "failed");

  const label = "mb-2 flex items-center gap-2 px-1 text-start text-[12px] leading-4 text-ink-tertiary";

  const steps = (
    <div className={cn("rounded-[18px] bg-ink/[0.035] p-4 transition-[background-color] duration-150 ease-[ease] motion-reduce:transition-none", notes.over && "bg-ink/[0.07]")}>
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
    <div data-bring-in="" data-bring-drop={notes.over ? "over" : undefined} className="w-full">
      {finds === null && <p role="status" data-bring-looking="" className="mb-6 text-[13px] leading-[18px] text-ink-tertiary">{t("bring.looking")}</p>}
      {found && (
        <section aria-labelledby={`${promptId}-found`} className="w-full text-start">
          <h2 id={`${promptId}-found`} className={cn(label, "m-0 font-normal")}>{t("bring.foundLabel")}</h2>
          <ul aria-label={t("bring.foundLabel")} className="m-0 flex list-none flex-col gap-0.5 rounded-[18px] bg-ink/[0.035] p-1.5">
            {rows.map((find) => <FindRow key={find.id} find={find} state={rowState(find)} busy={run.kind === "working"} onImport={() => onImport?.(find)} />)}
          </ul>
          {bringButton && !started && chosen.length > 1 && (
            <div className="mt-3 px-1">
              <button type="button" data-bring-go="" disabled={!chosen.length} onClick={onBring}
                className="ui-button ui-button-pill min-h-9 px-3.5 text-[13px] transition-[background-color,transform] duration-150 ease-[ease] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100">
                {t("bring.bring")}
              </button>
            </div>
          )}
          <RunLine run={run} />
        </section>
      )}
      {finds !== null && online}
      {notes.said && <StatusLine data-bring-notes={notes.said.state} state={notes.said.state} line={notes.said.line} />}
    </div>
  );
}
