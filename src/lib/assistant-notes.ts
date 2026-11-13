// Notes from an AI this computer can't read (ChatGPT, Claude, Gemini, Grok): the prompt is copied in the first run and
// the person goes straight on. The block that AI writes back can be pasted or dropped into any chat whenever it is
// ready; meanwhile the first bot's chat shows one quiet "waiting" line, and one reminder comes 15 minutes later.
import { useSyncExternalStore } from "react";
import { activeLocale, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { api, type Action, type Bot, type ConfigStatus } from "@/state/store";
import { aboutMeWithNotes, isNotesPrompt, looksLikeNotes, notesMemoryFile, notesMemoryText, NOTES_PROMPT, parseNotes, type AssistantNotes } from "../../shared/assistant-notes";
import { GrokImportError } from "../../shared/grok-import";
import { copyText } from "./copy-text";
import { saveTeamProfile } from "./own-profile";

export { isNotesPrompt, looksLikeNotes };

const KEY = "dusk.notesWaiting";
export const REMIND_AFTER_MS = 15 * 60_000;

export interface NotesWaiting { since: number; reminded?: boolean }

const listeners = new Set<() => void>();
let cached: { raw: string | null; value: NotesWaiting | null } = { raw: null, value: null };

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function notesWaiting(): NotesWaiting | null {
  const raw = storage()?.getItem(KEY) ?? null;
  if (raw === cached.raw) return cached.value;
  let value: NotesWaiting | null = null;
  try {
    const parsed = raw ? JSON.parse(raw) as Partial<NotesWaiting> : null;
    if (parsed && typeof parsed.since === "number") value = { since: parsed.since, ...(parsed.reminded ? { reminded: true } : {}) };
  } catch {}
  cached = { raw, value };
  return value;
}

function setWaiting(next: NotesWaiting | null) {
  try {
    if (next) storage()?.setItem(KEY, JSON.stringify(next));
    else storage()?.removeItem(KEY);
  } catch {}
  for (const listener of listeners) listener();
}

export function stopWaiting() { if (notesWaiting()) setWaiting(null); }

export function useNotesWaiting(): NotesWaiting | null {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, notesWaiting, () => null);
}

/** Copies the prompt and starts waiting for its answer; a copy again keeps the first start, so the reminder stays put. */
export async function copyNotesPrompt(now = Date.now()): Promise<boolean> {
  const copied = (await copyText(NOTES_PROMPT)) === "copied";
  if (copied && !notesWaiting()) setWaiting({ since: now });
  return copied;
}

/** One reminder, REMIND_AFTER_MS after the prompt was copied, only while still waiting and only once. Missed while the
 * app was closed, it is not shown late: the waiting line in the chat says it. Returns the cancel. */
export function scheduleNotesReminder(show: () => void, now = Date.now()): () => void {
  const waiting = notesWaiting();
  if (!waiting || waiting.reminded) return () => {};
  const left = waiting.since + REMIND_AFTER_MS - now;
  if (left < -60_000) {
    setWaiting({ ...waiting, reminded: true });
    return () => {};
  }
  const timer = setTimeout(() => {
    const still = notesWaiting();
    if (!still || still.reminded) return;
    setWaiting({ ...still, reminded: true });
    show();
  }, Math.max(0, left));
  return () => clearTimeout(timer);
}

export interface NotesContext {
  bots: readonly Bot[];
  aboutMe: string;
  team: boolean;
  /** The first bot, whose memory keeps what the other AI remembered. */
  firstBotId: string | null;
  dispatch: (action: Action) => void;
}

/** `failed`: bots that couldn't be made; `lost`: parts that couldn't be saved. */
export interface NotesOutcome { from: string; facts: number; memories: number; bots: number; failed: string[]; lost?: Array<"about" | "memory">; partial: boolean }

async function saveAboutMe(notes: AssistantNotes, context: NotesContext): Promise<number> {
  const about = aboutMeWithNotes(context.aboutMe, notes);
  if (!about) return 0;
  const profile = context.team
    ? await saveTeamProfile({ aboutMe: about.text })
    : (await api<ConfigStatus>("/api/config", { method: "PUT", body: JSON.stringify({ profile: { aboutMe: about.text } }), timeoutMs: 10_000 })).profile;
  context.dispatch({ type: "profileSaved", profile: { aboutMe: profile?.aboutMe ?? about.text } });
  return about.added;
}

async function saveMemories(notes: AssistantNotes, botId: string | null): Promise<number> {
  if (!botId || !notes.memories.length) return 0;
  const path = notesMemoryFile(notes);
  const file = `/api/bots/${encodeURIComponent(botId)}/memory/file`;
  const before = await api<{ text?: string }>(`${file}?path=${encodeURIComponent(path)}`).then((doc) => doc.text ?? "", () => "");
  const text = notesMemoryText(notes, before);
  if (!text) return 0;
  await api(file, { method: "PUT", body: JSON.stringify({ path, text }) });
  return notes.memories.length;
}

/** Everything in the notes, each part on its own: About me, the first bot's memory, then a bot for each of the other
 * AI's own assistants. A part that fails leaves the others in; the waiting stops once anything came in. */
export async function importNotes(text: string, context: NotesContext): Promise<NotesOutcome> {
  const notes = parseNotes(text);
  const outcome: NotesOutcome = { from: notes.from.name, facts: 0, memories: 0, bots: 0, failed: [], lost: [], partial: notes.partial };
  try { outcome.facts = await saveAboutMe(notes, context); } catch { outcome.lost!.push("about"); }
  try { outcome.memories = await saveMemories(notes, context.firstBotId); } catch { outcome.lost!.push("memory"); }
  if (notes.bots.length) {
    const [{ runBotMove }, { previewGrokMove }] = await Promise.all([import("./bot-move"), import("./grok-move")]);
    const servers = await api<{ servers?: Array<{ name: string }> }>("/api/mcp/servers").then((answer) => answer.servers ?? [], () => []);
    const preview = previewGrokMove(notes.bots, {
      bots: context.bots, servers: new Set(servers.map((server) => server.name)), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, from: notes.from,
    });
    const reports = await runBotMove({ apps: [{ app: notes.from.name, where: "", from: notes.from, preview, channels: [], unreadable: [] }], grokWaiting: [] }, context.dispatch);
    outcome.bots = reports.reduce((sum, one) => sum + one.report.bots.length, 0);
    outcome.failed.push(...reports.flatMap((one) => one.report.failed));
  }
  if (outcome.facts || outcome.memories || outcome.bots || !(outcome.failed.length || outcome.lost!.length)) stopWaiting();
  return outcome;
}

const list = (parts: string[]) => new Intl.ListFormat(activeLocale(), { style: "long", type: "conjunction" }).format(parts);
const count = (n: number, one: LocaleKey, many: LocaleKey) => (n === 1 ? t(one) : t(many, { count: n }));

/** One sentence for what came in, and what didn't. */
export function notesOutcomeLine(outcome: NotesOutcome): string {
  const parts = [
    ...(outcome.facts ? [count(outcome.facts, "composer.notes.factsOne", "composer.notes.facts")] : []),
    ...(outcome.memories ? [count(outcome.memories, "composer.notes.memoriesOne", "composer.notes.memories")] : []),
    ...(outcome.bots ? [count(outcome.bots, "composer.notes.botsOne", "composer.notes.bots")] : []),
  ];
  const lines = [parts.length ? t("composer.notes.added", { from: outcome.from, list: list(parts) }) : t("composer.notes.nothingNew", { from: outcome.from })];
  if (outcome.lost?.includes("about")) lines.push(t("composer.notes.lostAbout"));
  if (outcome.lost?.includes("memory")) lines.push(t("composer.notes.lostMemory"));
  if (outcome.failed.length) lines.push(t("composer.notes.failed", { names: list(outcome.failed) }));
  if (outcome.partial) lines.push(t("composer.notes.partial"));
  return lines.join(" ");
}

export function notesErrorLine(cause: unknown): string {
  if (cause instanceof GrokImportError) return t(`composer.notes.error.${cause.code}` as LocaleKey, { keys: cause.keys.join(", ") });
  return t("composer.notes.error.failed");
}

/** The first `.json`, `.md` or `.txt` file among dropped files that holds notes, read whole; null for none. */
export async function notesInFiles(files: readonly Pick<File, "name" | "size" | "text">[]): Promise<{ text: string; name: string } | null> {
  for (const file of files) {
    if (!/\.(?:json|md|txt)$/i.test(file.name) || file.size > 4 * 1024 * 1024) continue;
    try {
      const text = await file.text();
      if (looksLikeNotes(text)) return { text, name: file.name };
    } catch {}
  }
  return null;
}
