// The one-line "why" on a reply's receipt ("mostly reading 42 emails"): what the turn spent most of its steps on, read
// from the tools its digest counted. Plain words only, no tool names.
import type { TurnDigest } from "../../shared/digest";
import type { LocaleKey } from "@/locales";
import { t } from "./i18n";

type Kind = "email" | "calendar" | "search" | "pages" | "commands" | "edits" | "files" | "bots" | "steps";

// first match wins: mail and calendar before the generic readers
const KINDS: ReadonlyArray<[Kind, RegExp]> = [
  ["email", /gmail|outlook|e-?mail|\bmail|inbox/i],
  ["calendar", /calendar|event|meeting/i],
  ["search", /search(?!_?files)|tavily|exa\b|perplexity|google/i],
  ["pages", /fetch|brows|navigate|page|url|scrape|screenshot|click|web/i],
  ["commands", /bash|shell|command|exec|terminal|run_?code/i],
  ["edits", /edit|write|patch|create_?file|multiedit|apply/i],
  ["bots", /agents?_|delegat|ask_?bot|hand_?off|^task$/i],
  ["files", /read|grep|glob|\bls\b|list|view|open|find/i],
];

const KEYS: Record<Kind, LocaleKey> = {
  email: "chat.receipt.why.email", calendar: "chat.receipt.why.calendar", search: "chat.receipt.why.search", pages: "chat.receipt.why.pages",
  commands: "chat.receipt.why.commands", edits: "chat.receipt.why.edits", files: "chat.receipt.why.files", bots: "chat.receipt.why.bots", steps: "chat.receipt.why.steps",
};

export function kindOf(tool: string): Kind {
  return KINDS.find(([, pattern]) => pattern.test(tool))?.[0] ?? "steps";
}

/** "mostly reading 42 emails", or "mostly writing the reply" for a turn that used no tools. */
export function costWhy(digest: Pick<TurnDigest, "tools">): string {
  const counts = new Map<Kind, number>();
  for (const tool of digest.tools) counts.set(kindOf(tool.name), (counts.get(kindOf(tool.name)) ?? 0) + tool.count);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return t("chat.receipt.why.reply");
  return top[1] === 1 ? t(`${KEYS[top[0]]}One` as LocaleKey) : t(KEYS[top[0]], { count: String(top[1]) });
}

/** The receipt's cost line: "$0.18 · mostly reading 42 emails"; null when the turn has no price. */
export function receiptLine(digest: Pick<TurnDigest, "tools" | "usage">, format: (usd: number) => string): string | null {
  const usd = digest.usage?.costUsd;
  return typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? `${format(usd)} · ${costWhy(digest)}` : null;
}
