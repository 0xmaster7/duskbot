import type { NewBotDefaults } from "../../shared/new-bot-defaults";
import { api, type ModelSelection } from "@/state/store";

export interface BotDefaultsAnswer { defaults: NewBotDefaults; modelSelection: ModelSelection; suggestedName: string }

// Reading the defaults asks which AI is the default, which can take a moment: a create screen reads them as it opens,
// so the press that makes the bot goes straight to making it.
const PREFETCH_FRESH_MS = 30_000;
let prefetched: { at: number; answer: Promise<BotDefaultsAnswer> } | null = null;

export function prefetchBotDefaults(): void {
  if (prefetched && Date.now() - prefetched.at < PREFETCH_FRESH_MS) return;
  const answer = api<BotDefaultsAnswer>("/api/bot-defaults");
  const entry = { at: Date.now(), answer };
  prefetched = entry;
  answer.catch(() => { if (prefetched === entry) prefetched = null; });
}

/** The defaults a prefetch already read, used once while fresh, else read now. */
export function readBotDefaults(request: typeof api = api): Promise<BotDefaultsAnswer> {
  const held = prefetched;
  prefetched = null;
  if (held && request === api && Date.now() - held.at < PREFETCH_FRESH_MS) return held.answer.catch(() => request<BotDefaultsAnswer>("/api/bot-defaults"));
  return request<BotDefaultsAnswer>("/api/bot-defaults");
}

