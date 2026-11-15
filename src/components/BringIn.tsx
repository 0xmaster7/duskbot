// "Bring what you already use", the one flow for it: what this Mac holds from other AI apps, chosen and brought in on one
// press, with how it went said right here; and for AIs that live online (ChatGPT, Claude, Gemini, Grok), three steps
// around a prompt to copy, whose answer comes in when it is pasted or dropped here. The first run's bring step and
// Settings' import page both draw it; only what sits around it differs.
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, CircleAlert, Copy } from "../icons";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { copyNotesPrompt, looksLikeNotes, notesInFiles } from "@/lib/assistant-notes";
import { NOTES_PROMPT } from "../../shared/assistant-notes";
import { amountLine, bringFocus, broughtIds, memoryLine, onlyNotes, usedWhen, type BringRun, type LocalFind } from "@/lib/first-run-import";
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

type RowState = "idle" | "working" | "done";

/** "18 notes about you and 12 skills. Last used today.": the most personal parts only, never a list of everything. */
function lineFor(find: LocalFind, most: number): string {
  const summary = amountLine(find.amount, most);
  return find.lastUsed === null ? `${summary}.` : t("bring.summaryUsed", { summary, when: usedWhen(find.lastUsed) });
}

/** The bots arriving with it, by name, a few at most. */
function arrivingLine(find: LocalFind): string | null {
  const names = (find.bots?.preview.plans ?? []).map((plan) => plan.addedAs);
  if (!names.length) return null;
  return names.length > 3 ? t("bring.botsNamedMore", { names: listFormat(names.slice(0, 3)), count: names.length - 3 }) : t("bring.botsNamed", { names: listFormat(names) });
}

function Imported() {
  return (
    <span data-bring-imported="" className="inline-flex min-h-9 shrink-0 items-center gap-1 px-2 text-[13px] leading-[18px] text-ink-secondary">
      <Check size={14} aria-hidden="true" />{t("bring.imported")}
    </span>
  );
}

const ROW_BUTTON = "ui-button ui-button-pill min-h-9 shrink-0 gap-1.5 px-3.5 text-[13px] transition-[background-color,transform] duration-150 ease-[ease] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100";

/** The one source worth it most, said the way a person would: you use it a lot, bring what it knows? */
function HeroFind({ find, state, busy, can, primary, said, onImport }: { find: LocalFind; state: RowState; busy: boolean; can: boolean; primary: boolean; said: string | null; onImport: () => void }) {
  const knows = find.amount.notes + find.amount.memories > 0;
  const bots = arrivingLine(find);
  const done = state === "done";
  return (
    <div data-bring-find={find.id} data-bring-hero="" data-bring-state={state} className="flex flex-col gap-4 rounded-[20px] bg-ink/[0.035] p-5 text-start">
      <div className="flex min-w-0 items-start gap-3.5">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-[13px] bg-app"><FindMark find={find} size={22} /></span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-pretty text-[16px] font-medium leading-[22px] text-ink">
            {find.strong ? t("bring.heroUses", { app: find.app }) : t("bring.heroHere", { app: find.app })}
          </span>
          {done ? (
            <span role="status" data-bring-said="" className="flex items-start gap-1.5 text-pretty text-[14px] leading-5 text-ink">
              <Check size={15} aria-hidden="true" className="mt-[3px] shrink-0" />{said ?? t("bring.imported")}
            </span>
          ) : (
            <>
              <span className="text-pretty text-[14px] leading-5 text-ink-secondary">{knows ? t("bring.heroAsk") : t("bring.heroAskSetup")}</span>
              <span className="mt-1 text-[13px] leading-[18px] text-ink-tertiary">{lineFor(find, 3)}</span>
              {bots && <span className="text-pretty text-[13px] leading-[18px] text-ink-tertiary">{bots}</span>}
            </>
          )}
        </span>
      </div>
      {!done && can && (
        <button type="button" data-bring-import={find.id} data-primary={primary ? "" : undefined} autoFocus={primary} disabled={busy} onClick={onImport}
          aria-label={state === "working" ? undefined : t("bring.importApp", { app: find.app })}
          className="ui-button ui-button-pill ui-button-primary min-h-10 w-full gap-1.5 px-4 text-[14px] transition-[background-color,transform] duration-150 ease-[ease] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:scale-100 sm:w-auto sm:self-start">
          {state === "working" && <span aria-hidden="true" className="funnel-wait inline-block size-1.5 shrink-0 rounded-full bg-current" />}
          {state === "working" ? t("bring.importing") : t("bring.bringIt")}
        </button>
      )}
    </div>
  );
}

/** A smaller source: its mark, its name, what it holds and when it was used, and its own quiet Bring in. */
function FindRow({ find, state, busy, can, onImport }: { find: LocalFind; state: RowState; busy: boolean; can: boolean; onImport: () => void }) {
  return (
    <li data-bring-find={find.id} data-bring-state={state} className="flex min-w-0 items-center gap-3 rounded-[14px] px-3 py-2.5 text-start">
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-app"><FindMark find={find} size={16} /></span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-medium leading-5 text-ink">{find.app}</span>
        <span className="truncate text-[12px] leading-4 text-ink-tertiary">{lineFor(find, 2)}</span>
      </span>
      {state === "done" ? <Imported /> : can && (
        <button type="button" data-bring-import={find.id} disabled={busy} onClick={onImport} aria-label={state === "working" ? undefined : t("bring.importApp", { app: find.app })} className={ROW_BUTTON}>
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

/** What was found here, best first: the one worth it most as the hero, the next strong ones (two at most) as rows, the
 * rest behind Show more. The notes line counts only what is shown. */
export function useBringChoice(finds: readonly LocalFind[] | null, run: BringRun = { kind: "idle" }) {
  // the tools' notes come with them unless the person unticks it
  const [memory, setMemory] = useState(true);
  const [more, setMore] = useState(false);
  const brought = broughtIds(run);
  return useMemo(() => {
    const found = finds ?? [];
    // the source the card named leads, so the page answers it
    const named = found.findIndex((find) => find.id === bringFocus());
    const rows = named > 0 ? [found[named]!, ...found.slice(0, named), ...found.slice(named + 1)] : found;
    const hero = rows[0] ?? null;
    const next = rows.slice(1).filter((find, index) => find.strong && index < 2);
    const rest = rows.slice(1 + next.length);
    const shown = [...(hero ? [hero] : []), ...next, ...(more ? rest : [])];
    const memoryText = memoryLine(shown.filter((find) => !brought.includes(find.id)));
    return { rows, hero, next, rest, more, setMore, found: rows.length > 0, memory: memory && memoryText !== null, memoryText, setMemory };
  }, [finds, brought, memory, more]);
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

export function BringIn({ finds, choice, grokWaiting, run, heroPrimary = false, onImport }: {
  /** null while still looking. */
  finds: readonly LocalFind[] | null;
  choice: BringChoice;
  /** Grok bot's bots on this computer with nothing saved yet, by name: they move through the prompt, like an AI online. */
  grokWaiting: readonly string[];
  /** The bringing in, once started (useBringRun). */
  run: BringRun;
  /** The hero's button is the screen's one primary action and takes focus (the first run). */
  heroPrimary?: boolean;
  /** One app's own Bring in. */
  onImport?: (find: LocalFind) => void;
}) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const [open, setOpen] = useState(false);
  // with things found here the prompt for AIs online is one quiet line until asked for
  const [onlineOpen, setOnlineOpen] = useState(false);
  const notes = useNotesHere();
  const promptId = useId();
  const { found } = choice;
  const brought = broughtIds(run);
  const busy = run.kind === "working";
  const rowState = (find: LocalFind): RowState => brought.includes(find.id) ? "done" : busy && run.ids.includes(find.id) ? "working" : "idle";
  // with its notes left out, a source that holds only notes has nothing to bring
  const can = (find: LocalFind) => choice.memory || !onlyNotes(find);
  // the last bringing in was the hero's: it says how it went in its own words, where the person is looking
  const [heroLast, setHeroLast] = useState(false);
  const showOnline = !found || onlineOpen;
  const copyPrompt = async () => setCopy((await copyNotesPrompt()) ? "copied" : "failed");

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
      {found && choice.hero && (
        <section aria-labelledby={`${promptId}-found`} className="w-full text-start">
          <h2 id={`${promptId}-found`} className="sr-only">{t("bring.foundLabel")}</h2>
          <HeroFind find={choice.hero} state={rowState(choice.hero)} busy={busy} can={can(choice.hero)} primary={heroPrimary}
            said={run.kind === "done" && heroLast ? run.line : null} onImport={() => { setHeroLast(true); onImport?.(choice.hero!); }} />
          {(choice.next.length > 0 || (choice.more && choice.rest.length > 0)) && (
            <ul aria-label={t("bring.alsoHere")} className="m-0 mt-2 flex list-none flex-col gap-0.5 p-0">
              {[...choice.next, ...(choice.more ? choice.rest : [])].map((find) => (
                <FindRow key={find.id} find={find} state={rowState(find)} busy={busy} can={can(find)} onImport={() => { setHeroLast(false); onImport?.(find); }} />
              ))}
            </ul>
          )}
          {choice.rest.length > 0 && !choice.more && (
            <button type="button" data-bring-more="" onClick={() => choice.setMore(true)}
              className="mt-1 flex min-h-9 items-center gap-1 rounded-full px-3 text-[13px] leading-[18px] text-ink-tertiary transition-colors duration-150 ease-[ease] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
              {t("bring.showMore", { count: choice.rest.length })}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          )}
          {choice.memoryText && run.kind !== "working" && (
            <label data-bring-memory={choice.memory ? "on" : "off"} className="mt-2 flex min-h-11 cursor-pointer items-start gap-3 rounded-[14px] px-3 py-2.5 text-start transition-[background-color] duration-150 ease-[ease] hover:bg-ink/[0.035] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus motion-reduce:transition-none">
              <input type="checkbox" checked={choice.memory} onChange={(event) => choice.setMemory(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--color-ink)] focus-visible:outline-none" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-medium leading-[18px] text-ink">{t("bring.memoryTitle")}</span>
                <span className="text-pretty text-[12px] leading-4 text-ink-tertiary">{t("bring.memoryBody", { list: choice.memoryText })}</span>
              </span>
            </label>
          )}
          {!(heroLast && run.kind === "done") && <RunLine run={run} />}
        </section>
      )}
      {finds !== null && online}
      {notes.said && <StatusLine data-bring-notes={notes.said.state} state={notes.said.state} line={notes.said.line} />}
    </div>
  );
}
