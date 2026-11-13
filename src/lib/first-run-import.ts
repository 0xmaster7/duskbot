// The first run's "bring what you already use": what this Mac holds from other AI apps as one short list, app by app,
// all chosen; one press brings the chosen in while the run goes on, and a single quiet line says how it went.
import { useSyncExternalStore } from "react";
import { activeLocale, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { api, type Action } from "@/state/store";
import type { InstructionsSource, SetupDetection, SetupImportResult, SetupSource } from "../../shared/setup-import";
import { movable, planCounts, runBotMove, type AppMove, type BotMovePlan } from "./bot-move";
import { aboutMeSaver } from "./assistant-notes";
import { postImportNote } from "./import-note";
import { setupImportApi, type SetupImportClient } from "./setup-import";

export interface LocalFind {
  /** "bots:<app key>" for another agent app's bots; "setup:<source>" for an AI tool's skills, tools and instructions. */
  id: string;
  app: string;
  summary: string;
  bots?: AppMove;
  source?: SetupSource;
}

const list = (parts: string[]) => new Intl.ListFormat(activeLocale(), { style: "long", type: "conjunction" }).format(parts);
const count = (n: number, one: LocaleKey, many: LocaleKey) => (n === 1 ? t(one) : t(many, { count: n }));
const SOURCE_ORDER: SetupSource[] = ["claudeCode", "claudeDesktop", "codex", "cursor", "gemini", "windsurf", "vscode", "openhands"];

/** One app's bots in counts: the bots by name, then their skills, routines, memory and facts about the person. */
function botsSummary(app: AppMove): string {
  const names = app.preview.plans.map((one) => one.addedAs);
  const counts = planCounts(app);
  const bots = `${count(names.length, "botMove.botsOne", "botMove.bots")}: ${list(names.slice(0, 3))}${names.length > 3 ? "…" : ""}`;
  const rest = [
    ...(counts.skills ? [count(counts.skills, "botMove.skillsOne", "botMove.skills")] : []),
    ...(counts.routines ? [count(counts.routines, "bring.routinesOne", "bring.routines")] : []),
    ...(counts.memories ? [count(counts.memories, "bring.memoriesOne", "bring.memories")] : []),
    ...(counts.facts ? [count(counts.facts, "botMove.factsOne", "botMove.facts")] : []),
  ];
  return rest.length ? `${bots}. ${list(rest)}` : bots;
}

/** Bots first (they are the most to lose), then each AI tool once with everything new in it. A tool whose agents came
 * in as bots (Claude Code's, Gemini CLI's) is one row with both. */
export function localFinds(plan: BotMovePlan | null, detection: SetupDetection | null): LocalFind[] {
  const finds: LocalFind[] = [];
  for (const app of plan?.apps ?? []) {
    if (!app.preview.plans.length) continue;
    finds.push({ id: `bots:${app.from.key}`, app: app.app, bots: app, summary: botsSummary(app) });
  }
  for (const source of SOURCE_ORDER) {
    const skills = detection?.skills.filter((one) => one.source === source).length ?? 0;
    const tools = detection?.tools.filter((one) => one.source === source).length ?? 0;
    const instructions = detection?.instructions?.some((one) => one.source === source) ?? false;
    if (!skills && !tools && !instructions) continue;
    const parts = [
      ...(skills ? [count(skills, "botMove.skillsOne", "botMove.skills")] : []),
      ...(tools ? [count(tools, "bring.toolsOne", "bring.tools")] : []),
      ...(instructions ? [t("bring.instructions")] : []),
    ];
    const name = t(`onboarding.import.source.${source}` as LocaleKey);
    const same = finds.find((find) => find.bots && !find.source && find.app === name);
    if (same) Object.assign(same, { source, summary: `${same.summary}. ${list(parts)}` });
    else finds.push({ id: `setup:${source}`, app: name, source, summary: list(parts) });
  }
  return finds;
}

export type BringRun =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; line: string; failed: boolean };

let run: BringRun = { kind: "idle" };
const listeners = new Set<() => void>();
function set(next: BringRun) {
  run = next;
  for (const listener of listeners) listener();
}

export function useBringRun(): BringRun {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => run, () => run);
}

export const bringRunNow = (): BringRun => run;
export function resetBringRunForTests() { run = { kind: "idle" }; }

const INSTRUCTIONS_FILE: Record<InstructionsSource, string> = {
  claudeCode: "memory/instructions-from-claude-code.md",
  codex: "memory/instructions-from-codex.md",
  gemini: "memory/instructions-from-gemini-cli.md",
  windsurf: "memory/instructions-from-windsurf.md",
};

/** A tool's standing instructions as a topic of the first bot's memory: there to look up, not read into every turn. */
async function keepInstructions(files: NonNullable<SetupImportResult["instructions"]>, botId: string | null): Promise<number> {
  if (!botId) return 0;
  let kept = 0;
  // one topic per tool, holding each of its files (Windsurf keeps one in its old place and one in Devin's)
  for (const source of [...new Set(files.map((file) => file.source))]) {
    const own = files.filter((file) => file.source === source);
    const app = t(`onboarding.import.source.${source}` as LocaleKey);
    const text = `# Instructions from ${app}\n\nWhat you told ${app} in its ${[...new Set(own.map((file) => file.name))].join(" and ")}, brought over when you moved.\n\n${own.map((file) => file.text.trim()).join("\n\n")}\n`;
    try {
      await api(`/api/bots/${encodeURIComponent(botId)}/memory/file`, { method: "PUT", body: JSON.stringify({ path: INSTRUCTIONS_FILE[source], text }) });
      kept += own.length;
    } catch {}
  }
  return kept;
}

/** Brings the chosen finds in: the tools' things in one request, then each app's bots. Never throws; the line says what
 * came in. Runs once at a time; the funnel goes on meanwhile. */
export async function bringChosen(finds: readonly LocalFind[], context: {
  dispatch: (action: Action) => void; firstBotId: string | null; client?: SetupImportClient;
  /** About me as it is now, and whether it is the team's profile: facts the bots knew about the person go there. */
  aboutMe?: string; team?: boolean;
}): Promise<void> {
  if (run.kind === "working" || !finds.length) return;
  set({ kind: "working" });
  const client = context.client ?? setupImportApi;
  const sources = finds.flatMap((find) => (find.source ? [find.source] : []));
  const apps = finds.flatMap((find) => (find.bots ? [find.bots] : []));
  let skills = 0, tools = 0, instructions = 0, bots = 0, failed = false;
  const botNames: string[] = [];
  let facts = 0, memories = 0, routines = 0, reconnect = 0;
  const kept: string[] = [];
  if (sources.length) {
    try {
      const result = await client.apply({ skills: true, tools: true, instructions: true, sources });
      skills = result.skills?.added.length ?? 0;
      tools = result.tools?.added.length ?? 0;
      instructions = await keepInstructions(result.instructions ?? [], context.firstBotId);
      if (instructions) kept.push(...new Set((result.instructions ?? []).map((file) => t(`onboarding.import.source.${file.source}` as LocaleKey))));
      failed ||= Boolean(result.skills?.skipped.some((one) => one.reason === "failed") || result.tools?.skipped.some((one) => one.reason === "failed"))
        || instructions < (result.instructions?.length ?? 0);
    } catch {
      failed = true;
    }
  }
  if (apps.length) {
    try {
      const plan: BotMovePlan = { apps, grokWaiting: [] };
      if (movable(plan)) {
        const saveFacts = aboutMeSaver({ aboutMe: context.aboutMe ?? "", team: Boolean(context.team), dispatch: context.dispatch });
        const reports = await runBotMove(plan, context.dispatch, undefined, context.aboutMe === undefined ? undefined : saveFacts);
        const moved = reports.flatMap((one) => one.report.bots);
        bots = moved.length;
        botNames.push(...moved.map((bot) => bot.name));
        facts = moved.reduce((sum, bot) => sum + (bot.facts ?? 0), 0);
        memories = moved.reduce((sum, bot) => sum + bot.memories + bot.notes, 0);
        routines = moved.reduce((sum, bot) => sum + bot.routines, 0);
        reconnect = moved.reduce((sum, bot) => sum + bot.apps, 0);
        failed ||= reports.some((one) => one.report.failed.length > 0);
      }
    } catch {
      failed = true;
    }
  }
  const parts = [
    ...(bots ? [count(bots, "botMove.botsOne", "botMove.bots")] : []),
    ...(skills ? [count(skills, "botMove.skillsOne", "botMove.skills")] : []),
    ...(tools ? [count(tools, "bring.toolsOne", "bring.tools")] : []),
    ...(instructions ? [t("bring.instructions")] : []),
  ];
  const line = [parts.length ? t("bring.done", { list: list(parts) }) : failed ? "" : t("bring.allHere"), failed ? t("bring.failed") : ""].filter(Boolean).join(" ");
  set({ kind: "done", line, failed });
  if (context.firstBotId && (bots || skills || tools || instructions)) {
    const from = [...new Set(finds.filter((find) => find.bots || find.source).map((find) => find.app))];
    void postImportNote(context.firstBotId, { from, bots: botNames, facts, memories, skills, tools, routines, instructions: kept, reconnect, failed });
  }
}
