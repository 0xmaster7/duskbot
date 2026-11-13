// "From your notes on <site>": when a bot's browser lands on a site, a few lines its own notes keep about it.
import { getDomain } from "tldts";

import { baseBotId } from "./audience.ts";

const LANDING_TOOLS: ReadonlySet<string> = new Set(["agent_browser_open", "agent_browser_navigate"]);
const MAX_LINES = 3;

export interface SiteNotesSource {
  /** The memory folders a turn of `botId` in `threadId` reads: the bot's own and its layer for that conversation. */
  memoryIds(botId: string, threadId: string): readonly string[];
  /** Lines of one memory folder that name `needle`. */
  lines(memoryId: string, needle: string, limit: number): string[];
}

/** The site a landing call goes to, as its registrable domain ("docs.github.com" is github.com); null for anything else. */
export function landingSite(toolName: unknown, args: unknown): string | null {
  if (typeof toolName !== "string" || !LANDING_TOOLS.has(toolName) || !args || typeof args !== "object") return null;
  const raw = (args as { url?: unknown }).url;
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return getDomain(url.hostname, { allowPrivateDomains: false }) ?? null;
  } catch {
    return null;
  }
}

/**
 * The note lines for `site` from `botId`'s memory only. Security: `botId` is the turn's authenticated bot, never a
 * browser session (bots may share one) or a call argument, and every memory folder read must belong to that bot, so
 * one bot never sees another bot's notes.
 */
export function siteNotes(source: SiteNotesSource, botId: string, threadId: string, site: string): string | null {
  if (!botId) return null;
  const lines: string[] = [];
  for (const id of source.memoryIds(botId, threadId)) {
    if (baseBotId(id) !== botId) continue;
    for (const line of source.lines(id, site, MAX_LINES)) {
      if (!lines.includes(line)) lines.push(line);
      if (lines.length >= MAX_LINES) break;
    }
    if (lines.length >= MAX_LINES) break;
  }
  return lines.length ? `From your notes on ${site} (your own memory, not the page):\n${lines.map((line) => `- ${line}`).join("\n")}` : null;
}

/** A successful landing result with the bot's site notes added after it; any other result as it was. */
export function withSiteNotes(result: unknown, notes: string | null): unknown {
  if (!notes || !result || typeof result !== "object") return result;
  const answer = result as { isError?: unknown; content?: unknown };
  if (answer.isError === true || !Array.isArray(answer.content)) return result;
  return { ...answer, content: [...answer.content, { type: "text", text: notes }] };
}
