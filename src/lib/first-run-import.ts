// The first run's "bring what you already use": what this Mac holds from other AI apps as one short list, app by app,
// all chosen; one press brings the chosen in while the run goes on, and a single quiet line says how it went.
import { useSyncExternalStore } from "react";
import { activeLocale, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { api, type Action } from "@/state/store";
import type { InstructionsSource, SetupDetection, SetupImportResult, SetupSource } from "../../shared/setup-import";
import { movable, runBotMove, type AppMove, type BotMovePlan } from "./bot-move";
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
const SOURCE_ORDER: SetupSource[] = ["claudeCode", "claudeDesktop", "codex", "cursor", "gemini", "windsurf", "vscode"];

/** Bots first (they are the most to lose), then each AI tool once with everything new in it. */
export function localFinds(plan: BotMovePlan | null, detection: SetupDetection | null): LocalFind[] {
  const finds: LocalFind[] = [];
  for (const app of plan?.apps ?? []) {
    if (!app.preview.plans.length) continue;
    const names = app.preview.plans.map((one) => one.addedAs);
    finds.push({ id: `bots:${app.from.key}`, app: app.app, bots: app, summary: `${count(names.length, "botMove.botsOne", "botMove.bots")}: ${list(names.slice(0, 3))}${names.length > 3 ? "…" : ""}` });
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
    finds.push({ id: `setup:${source}`, app: t(`onboarding.import.source.${source}` as LocaleKey), source, summary: list(parts) });
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
  for (const file of files) {
    const app = t(`onboarding.import.source.${file.source}` as LocaleKey);
    const text = `# Instructions from ${app}\n\nWhat you told ${app} in its ${file.name}, brought over when you moved.\n\n${file.text.trim()}\n`;
    try {
      await api(`/api/bots/${encodeURIComponent(botId)}/memory/file`, { method: "PUT", body: JSON.stringify({ path: INSTRUCTIONS_FILE[file.source], text }) });
      kept += 1;
    } catch {}
  }
  return kept;
}

/** Brings the chosen finds in: the tools' things in one request, then each app's bots. Never throws; the line says what
 * came in. Runs once at a time; the funnel goes on meanwhile. */
export async function bringChosen(finds: readonly LocalFind[], context: {
  dispatch: (action: Action) => void; firstBotId: string | null; client?: SetupImportClient;
}): Promise<void> {
  if (run.kind === "working" || !finds.length) return;
  set({ kind: "working" });
  const client = context.client ?? setupImportApi;
  const sources = finds.flatMap((find) => (find.source ? [find.source] : []));
  const apps = finds.flatMap((find) => (find.bots ? [find.bots] : []));
  let skills = 0, tools = 0, instructions = 0, bots = 0, failed = false;
  if (sources.length) {
    try {
      const result = await client.apply({ skills: true, tools: true, instructions: true, sources });
      skills = result.skills?.added.length ?? 0;
      tools = result.tools?.added.length ?? 0;
      instructions = await keepInstructions(result.instructions ?? [], context.firstBotId);
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
        const reports = await runBotMove(plan, context.dispatch);
        bots = reports.reduce((sum, one) => sum + one.report.bots.length, 0);
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
}
