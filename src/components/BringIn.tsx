// "Bring what you already use", the one flow for it. The first run's step offers one thing: the memory of the one app
// this person genuinely uses here (used on most days lately, holding notes about them), and beside it, or alone when
// there is none, the chat AI path: copy a prompt, paste it into Grok, ChatGPT, Claude or Gemini, paste its answer back,
// and it becomes their memory. Settings' import page adds everything else this computer holds, each on its own.
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Check, CircleAlert, Copy, ChevronDown } from "../icons";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { copyNotesPrompt, looksLikeNotes, notesInFiles } from "@/lib/assistant-notes";
import { MEMORY_PROMPT, notesFromPlainText } from "../../shared/assistant-notes";
import { amountLine, bringFocus, broughtIds, knowsLine, memorySource, type BringRun, type LocalFind } from "@/lib/first-run-import";
import { MausAvatar } from "./Avatar";
import { GrokBotMark } from "./GrokBotMark";
import { useNotesIntake, type NotesSay } from "./NotesWaiting";
import { ClaudeMark, CodexMark, CursorMark, GeminiMark, GrokMark, HermesMark } from "./ProviderIcons";
import { OpenClawMark } from "./OpenClawMark";
import { PixelIcon } from "./ui/PixelIcon";

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

const listFormat = (parts: string[]) => new Intl.ListFormat(activeLocale(), { style: "long", type: "conjunction" }).format(parts);

type RowState = "idle" | "working" | "done";

/** "18 notes about you and 12 skills. Used on 4 of the last 30 days.": what it holds and how much it is really used. */
function lineFor(find: LocalFind): string {
  const summary = amountLine(find.amount, 2);
  return find.activeDays ? t("bring.summaryDays", { summary, count: Math.min(find.activeDays, 30) }) : `${summary}.`;
}

const ROW_BUTTON = "ui-button ui-button-pill min-h-9 shrink-0 gap-1.5 px-3.5 text-[13px] transition-[background-color,transform] duration-150 ease-[ease] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100";
const PRIMARY_BUTTON = "ui-button ui-button-pill ui-button-primary min-h-10 gap-1.5 px-4 text-[14px] transition-[background-color,transform] duration-150 ease-[ease] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:scale-100";

/** The one app that knows this person, said as a person would: it already knows you; bring what it's learned. Its bots,
 * skills and tools come along quietly; only the memory is offered. */
function MemorySource({ find, state, busy, primary, said, onImport }: { find: LocalFind; state: RowState; busy: boolean; primary: boolean; said: string | null; onImport: () => void }) {
  const done = state === "done";
  const days = Math.min(find.activeDays ?? 0, 30);
  return (
    <div data-bring-find={find.id} data-bring-hero="" data-bring-state={state} className="flex flex-col gap-4 rounded-[20px] bg-ink/[0.035] p-5 text-start">
      <div className="flex min-w-0 items-start gap-3.5">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-[13px] bg-app"><FindMark find={find} size={22} /></span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[16px] font-medium leading-[22px] text-ink">{t("bring.knowsYou", { app: find.app })}</span>
          {done ? (
            <span role="status" data-bring-said="" className="flex items-start gap-1.5 text-pretty text-[14px] leading-5 text-ink">
              <Check size={15} aria-hidden="true" className="mt-[3px] shrink-0" />{said ?? t("bring.imported")}
            </span>
          ) : (
            <>
              <span data-bring-topics="" className="text-pretty text-[14px] leading-5 text-ink-secondary">{knowsLine(find)}</span>
              <span className="mt-1 text-[13px] leading-[18px] text-ink-tertiary">{t("bring.usedDays", { count: days })}</span>
            </>
          )}
        </span>
      </div>
      {!done && (
        <button type="button" data-bring-import={find.id} data-primary={primary ? "" : undefined} autoFocus={primary} disabled={busy} onClick={onImport}
          aria-label={state === "working" ? undefined : t("bring.importApp", { app: find.app })} className={cn(PRIMARY_BUTTON, "w-full sm:w-auto sm:self-start")}>
          {state === "working" && <span aria-hidden="true" className="funnel-wait inline-block size-1.5 shrink-0 rounded-full bg-current" />}
          {state === "working" ? t("bring.importing") : t("bring.bringIt")}
        </button>
      )}
    </div>
  );
}

function Imported() {
  return (
    <span data-bring-imported="" className="inline-flex min-h-9 shrink-0 items-center gap-1 px-2 text-[13px] leading-[18px] text-ink-secondary">
      <Check size={14} aria-hidden="true" />{t("bring.imported")}
    </span>
  );
}

/** Anything else this computer holds (Settings only): its mark, what it holds, and its own quiet Bring in. */
function FindRow({ find, state, busy, onImport }: { find: LocalFind; state: RowState; busy: boolean; onImport: () => void }) {
  return (
    <li data-bring-find={find.id} data-bring-state={state} className="flex min-w-0 items-center gap-3 rounded-[14px] px-3 py-2.5 text-start">
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-app"><FindMark find={find} size={16} /></span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-medium leading-5 text-ink">{find.app}</span>
        <span className="truncate text-[12px] leading-4 text-ink-tertiary">{lineFor(find)}</span>
      </span>
      {state === "done" ? <Imported /> : (
        <button type="button" data-bring-import={find.id} disabled={busy} onClick={onImport} aria-label={state === "working" ? undefined : t("bring.importApp", { app: find.app })} className={ROW_BUTTON}>
          {state === "working" && <span aria-hidden="true" className="funnel-wait inline-block size-1.5 shrink-0 rounded-full bg-ink/60" />}
          {state === "working" ? t("bring.importing") : t("bring.import")}
        </button>
      )}
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

/** The one memory source, and (for Settings) everything else here. The source the bring card named leads when it
 * still qualifies, so the page answers the card. */
export function useBringChoice(finds: readonly LocalFind[] | null) {
  return useMemo(() => {
    const rows = finds ?? [];
    const named = rows.find((find) => find.id === bringFocus());
    const source = (named && memorySource([named])) ?? memorySource(rows);
    // the rest by how much each is really used, then by how much it holds
    const others = rows.filter((find) => find !== source).sort((a, b) => (b.activeDays ?? 0) - (a.activeDays ?? 0) || b.score - a.score);
    return { rows, source, others, found: rows.length > 0 };
  }, [finds]);
}
export type BringChoice = ReturnType<typeof useBringChoice>;

/** The chat AIs people talk to, as their own app icons. */
const CHAT_AIS: ReadonlyArray<{ key: string; name: string; tile: string; mark: (size: number) => ReactNode }> = [
  { key: "chatgpt", name: "ChatGPT", tile: "bg-[#10a37f]", mark: (size) => <CodexMark size={size} className="fill-[#fafafa]" /> },
  { key: "claude", name: "Claude", tile: "bg-[#f5efe6]", mark: (size) => <ClaudeMark size={size} /> },
  { key: "gemini", name: "Gemini", tile: "bg-[#eef3fd]", mark: (size) => <GeminiMark size={size} /> },
  { key: "grok", name: "Grok", tile: "bg-[#141416]", mark: (size) => <GrokMark size={size} className="fill-[#fafafa]" /> },
];

/** The second way in, or the only one: copy the prompt, paste it into the chat AI, paste its answer back here, and it
 * becomes the person's memory. An answer without the layout still comes in, a line per memory. */
function ChatAiPath({ lead, notes, grokWaiting }: { lead: boolean; notes: ReturnType<typeof useNotesHere>; grokWaiting: readonly string[] }) {
  const id = useId();
  const [ai, setAi] = useState(CHAT_AIS[0]!);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const copyPrompt = async () => setCopy((await copyNotesPrompt(Date.now(), MEMORY_PROMPT)) ? "copied" : "failed");
  const bring = () => {
    if (!text.trim()) return;
    notes.bring(notesFromPlainText(text, ai.name));
    setText("");
  };
  return (
    <section data-bring-prompt="" aria-labelledby={`${id}-title`} className={cn("w-full text-start", !lead && "mt-6")}>
      <h2 id={`${id}-title`} className={cn("m-0 font-medium text-ink", lead ? "text-[16px] leading-[22px]" : "text-[14px] leading-5")}>
        {lead ? t("bring.chatTitle") : t("bring.chatTitleOr")}
      </h2>
      <p className="m-0 mt-1 text-pretty text-[13px] leading-[18px] text-ink-secondary">{t("bring.chatSub")}</p>
      <div role="group" aria-label={t("bring.chatPick")} className="mt-3 flex flex-wrap gap-2">
        {CHAT_AIS.map((one) => (
          <button key={one.key} type="button" data-bring-ai={one.key} aria-pressed={ai.key === one.key} onClick={() => setAi(one)}
            className={cn("inline-flex min-h-9 items-center gap-2 rounded-full py-1 ps-1.5 pe-3.5 text-[13px] leading-[18px] transition-[background-color,color] duration-150 ease-[ease] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none",
              ai.key === one.key ? "bg-ink/[0.1] font-medium text-ink" : "bg-ink/[0.035] text-ink-secondary hover:bg-ink/[0.06] hover:text-ink")}>
            <span aria-hidden="true" data-bring-logo={one.key} className={cn("grid size-6 place-items-center rounded-full", one.tile)}>{one.mark(13)}</span>
            {one.name}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <button type="button" data-bring-copy="" onClick={() => void copyPrompt()} className={lead ? PRIMARY_BUTTON : ROW_BUTTON}>
          {copy === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{copy === "copied" ? t("bring.copiedShort") : t("bring.chatCopy")}</span>
        </button>
        <button type="button" data-bring-see="" aria-expanded={open} aria-controls={`${id}-text`} onClick={() => setOpen((was) => !was)}
          className="flex min-h-9 items-center gap-1 rounded-full px-2.5 text-[13px] leading-[18px] text-ink-tertiary transition-colors duration-150 ease-[ease] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
          <span>{open ? t("bring.hidePrompt") : t("bring.seePrompt")}</span>
          <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform duration-200 ease-[var(--dusk-ease-out)] motion-reduce:transition-none", open && "rotate-180")} />
        </button>
      </div>
      {copy !== "idle" && (
        <p role="status" data-bring-copied={copy} className={cn("place-reveal m-0 mt-2 text-pretty text-[12px] leading-4", copy === "failed" ? "text-danger" : "text-ink-tertiary")}>
          {copy === "failed" ? t("bring.copyFailed") : t("bring.chatCopied", { ai: ai.name })}
        </p>
      )}
      <div id={`${id}-text`} inert={!open} className={cn("grid transition-[grid-template-rows,opacity] duration-[240ms] ease-[var(--dusk-ease-out)] motion-reduce:transition-none", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="min-h-0 overflow-hidden">
          <pre tabIndex={open ? 0 : -1} aria-label={t("bring.promptLabel")}
            className="m-0 mt-3 max-h-[200px] overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-[12px] bg-ink/[0.035] px-3.5 py-3 font-mono text-[12px] leading-[18px] text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {MEMORY_PROMPT}
          </pre>
        </div>
      </div>
      <label htmlFor={`${id}-paste`} className="mt-4 block text-[12px] leading-4 text-ink-tertiary">{t("bring.chatPasteLabel", { ai: ai.name })}</label>
      <textarea id={`${id}-paste`} data-bring-paste="" rows={3} value={text} onChange={(event) => setText(event.target.value)} placeholder={t("bring.chatPastePlaceholder")}
        className={cn("mt-1.5 block w-full resize-none rounded-[14px] bg-ink/[0.035] px-3.5 py-3 text-[13px] leading-[18px] text-ink outline-none transition-[background-color] duration-150 ease-[ease] placeholder:text-ink-tertiary focus-visible:bg-ink/[0.05] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none",
          notes.over && "bg-ink/[0.07]")} />
      {text.trim() && (
        <button type="button" data-bring-paste-go="" onClick={bring} className={cn(ROW_BUTTON, "mt-2")}>{t("bring.chatBring")}</button>
      )}
      {notes.said && <StatusLine data-bring-notes={notes.said.state} state={notes.said.state} line={notes.said.line} />}
      {grokWaiting.length > 0 && (
        <p data-bring-grok="" className="m-0 mt-3 text-pretty text-[12px] leading-4 text-ink-tertiary">
          {t("bring.grokLine", { names: listFormat([...grokWaiting]) })}{" "}
          <button type="button" data-bring-grok-copy="" onClick={() => void copyNotesPrompt()} className="rounded text-ink-secondary underline decoration-ink/25 underline-offset-2 hover:text-ink hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">{t("bring.grokCopy")}</button>
        </p>
      )}
    </section>
  );
}

/** Notes from another AI, pasted or dropped while this is open, come in here and say how it went here. Nothing behind
 * sees them: the chat box would otherwise attach a dropped file, and one Send would hand it to its model. */
function useNotesHere(): { said: { line: string; state: "working" | "done" | "failed" } | null; over: boolean; bring(text: string): void } {
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
  const bring = useCallback((text: string) => takeNotes(text, (line, state) => setSaid({ line, state }), "paste"), [takeNotes]);
  return { said, over, bring };
}

export function BringIn({ finds, choice, grokWaiting, run, mode, heroPrimary = false, onImport, onNotes }: {
  /** null while still looking. */
  finds: readonly LocalFind[] | null;
  choice: BringChoice;
  /** Grok bot's bots on this computer with nothing saved yet, by name: they move through the prompt, like an AI online. */
  grokWaiting: readonly string[];
  /** The bringing in, once started (useBringRun). */
  run: BringRun;
  /** "step": the first run, one memory source at most; "settings": everything this computer holds too. */
  mode: "step" | "settings";
  /** The memory source's button is the screen's one primary action and takes focus (the first run). */
  heroPrimary?: boolean;
  /** One app's own Bring in. */
  onImport?: (find: LocalFind) => void;
  /** Notes from the chat AI came in. */
  onNotes?: () => void;
}) {
  const notes = useNotesHere();
  const brought = broughtIds(run);
  const busy = run.kind === "working";
  const rowState = (find: LocalFind): RowState => brought.includes(find.id) ? "done" : busy && run.ids.includes(find.id) ? "working" : "idle";
  const { source } = choice;
  const others = mode === "settings" ? choice.others : [];
  // the last bringing in was the source's own: it says how it went where the person is looking
  const [sourceLast, setSourceLast] = useState(false);
  const said = run.kind === "done" && sourceLast
    ? (run.known ? (run.known === 1 ? t("bring.knowDoneOne") : t("bring.knowDone", { count: run.known })) : run.line)
    : null;
  const notesDone = notes.said?.state === "done";
  useEffect(() => { if (notesDone) onNotes?.(); }, [notesDone, onNotes]);

  return (
    <div data-bring-in="" data-bring-drop={notes.over ? "over" : undefined} className="w-full">
      {finds === null && <p role="status" data-bring-looking="" className="mb-6 text-[13px] leading-[18px] text-ink-tertiary">{t("bring.looking")}</p>}
      {source && (
        <MemorySource find={source} state={rowState(source)} busy={busy} primary={heroPrimary} said={said}
          onImport={() => { setSourceLast(true); onImport?.(source); }} />
      )}
      {others.length > 0 && (
        <section aria-labelledby="bring-others" className="mt-5 w-full text-start">
          <h2 id="bring-others" className="m-0 mb-1 px-1 text-[12px] font-normal leading-4 text-ink-tertiary">{t("bring.alsoHere")}</h2>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {others.map((find) => <FindRow key={find.id} find={find} state={rowState(find)} busy={busy} onImport={() => { setSourceLast(false); onImport?.(find); }} />)}
          </ul>
          {!sourceLast && run.kind !== "idle" && <RunLine run={run} />}
        </section>
      )}
      {finds !== null && <ChatAiPath lead={!source} notes={notes} grokWaiting={grokWaiting} />}
    </div>
  );
}
