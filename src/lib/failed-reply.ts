// grok's failed-reply card: what stopped the newest replies, one card above the composer, never a row in the chat.
import { offersSignIn } from "@/components/EngineSetup";
import { statusActivity } from "@/lib/activity-runs";
import { t } from "@/lib/i18n";
import { peerLine } from "@/lib/peer-message";
import { plainErrorKind } from "@/lib/plain-error";
import { isReceipt } from "@/lib/receipts";
import type { LocaleKey } from "@/locales";
import type { InstanceInfo, Message } from "@/state/store";
import { failedTurnCause, type FailedReplyReason } from "../../shared/failed-turn";
import { trialCreditKind } from "../../shared/trial-credit";
import { isCancelledTranscriptRow } from "../../shared/client-cancel";

export type FailedReplyKind = FailedReplyReason | "claude_update" | "trial_credit" | "place" | "no_answer" | "other";

/** A failed turn's row: a reply that never came, not one that came back with a step that failed. */
export function isFailedReply(message: Message): boolean {
  const tool = message.tool;
  return message.kind === "activity" && Boolean(tool) && failedTurnCause(tool!.name) !== null && !tool!.partial && !isCancelledTranscriptRow(message);
}

/** A turn that ended without a word from its AI: no error row says it, so the card does. */
export function isUnansweredTurn(message: Message): boolean {
  return Boolean(message.tool?.rescue?.over);
}

/** A notice line a bot's turn left (a sign-out, a limit, a switch to another AI); never a live rescue or a stop. */
export function isFoldableNotice(message: Message): boolean {
  const status = statusActivity(message);
  return status !== null && status.kind !== "stopped" && !message.tool?.rescue;
}

/** The rows nothing has followed, since the person last wrote: per bot, its newest failed reply, and the notices after
 * its newest other row. A reply, a new message or a stop clears them. */
export function trailingRows(messages: readonly Message[], scan = 200): { failures: Message[]; notices: Message[] } {
  const settled = new Set<string>();
  const failures: Message[] = [];
  const notices: Message[] = [];
  for (let i = messages.length - 1; i >= 0 && i >= messages.length - scan; i -= 1) {
    const m = messages[i]!;
    if (m.role === "user" && !peerLine(m)) break;
    // what the turn's end leaves around its outcome (receipts, a digest, a call's record) is no newer reply
    if (isReceipt(m) || m.kind === "digest" || m.kind === "compaction" || m.kind === "call") continue;
    const who = m.from?.botId ?? "";
    if (settled.has(who)) continue;
    if (isFoldableNotice(m)) { notices.push(m); continue; }
    settled.add(who);
    if (isFailedReply(m) || isUnansweredTurn(m)) failures.push(m);
  }
  return { failures: failures.reverse(), notices: notices.reverse() };
}

export function trailingFailures(messages: readonly Message[], scan = 200): Message[] {
  return trailingRows(messages, scan).failures;
}

const SIGNED_OUT_WORDS = /not logged in|logged out|\/login|not signed in|sign in again|authentication required|unauthori[sz]ed|invalid api key|\b401\b/i;
const USAGE_WORDS = /usage limit|limit reached|hit your [\w' -]{0,30}limit/i;
const CREDIT_WORDS = /out of credits?|payment required|insufficient (?:funds|balance|credits?)/i;

/** What stopped a failed row: the server's own reading when it stored one, its flags and words for an older row. */
export function failedReplyKind(tool: NonNullable<Message["tool"]>, engine: InstanceInfo | undefined): FailedReplyKind {
  if (tool.rescue) return "no_answer";
  const cause = failedTurnCause(tool.name) ?? tool.name;
  if (tool.place) return "place";
  if (trialCreditKind(cause)) return "trial_credit";
  if (tool.claudeUpdate) return "claude_update";
  let kind: FailedReplyKind = tool.reason ?? (
    CREDIT_WORDS.test(cause) ? "credits"
    : tool.limitResetsAt || USAGE_WORDS.test(cause) ? "usage_limit"
    : tool.setup && SIGNED_OUT_WORDS.test(cause) ? "signed_out"
    : PLAIN_KIND[plainErrorKind(cause) ?? ""] ?? "other");
  // signed in again since: signing in is no longer the fix
  if (kind === "signed_out" && engine?.snapshot?.state === "available" && engine.snapshot.authenticated !== false) kind = "other";
  return kind;
}

const PLAIN_KIND: Partial<Record<string, FailedReplyKind>> = {
  "error.plain.rateLimited": "rate_limit",
  "error.plain.busy": "overloaded",
  "error.plain.timeout": "timeout",
};

/** What stopped a reply, in the card's plain words, when its engine words say a reason; null for any other failure. */
export function plainFailureWords(cause: string): string | null {
  const kind = PLAIN_KIND[plainErrorKind(cause) ?? ""];
  return kind && kind !== "other" && kind in DETAIL ? t(DETAIL[kind as keyof typeof DETAIL]) : null;
}

/** Most actionable first: when bots fail for different reasons, the card says the one a person can fix. */
const PRIORITY: FailedReplyKind[] = ["signed_out", "claude_update", "credits", "trial_credit", "usage_limit", "place", "rate_limit", "overloaded", "timeout", "no_answer", "other"];

export function mostActionable<T extends { kind: FailedReplyKind }>(items: readonly T[]): T | undefined {
  return [...items].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))[0];
}

const DETAIL: Record<Exclude<FailedReplyKind, "signed_out" | "credits" | "claude_update" | "trial_credit" | "place">, LocaleKey> = {
  usage_limit: "failedReply.usageLimit",
  rate_limit: "failedReply.rateLimited",
  overloaded: "failedReply.overloaded",
  timeout: "failedReply.timeout",
  no_answer: "error.plain.generic",
  other: "error.plain.generic",
};

/** The card's one plain line for a kind; place, trial and update failures bring their own words. */
export function failedReplyDetail(kind: FailedReplyKind, engineName: string, onServer: boolean): string {
  if (kind === "signed_out") return t(onServer ? "failedReply.signedOutServer" : "failedReply.signedOutHere", { engine: engineName });
  if (kind === "credits") return t("failedReply.credits", { engine: engineName });
  if (kind === "claude_update") return t("chat.claudeUpdate.offer");
  if (kind === "trial_credit" || kind === "place") return t("error.plain.generic");
  return t(DETAIL[kind]);
}

/** "Bot failed to respond" in a direct chat; in a group, who: "Echo couldn't respond", "Echo, Quill and 2 more couldn't respond". */
export function failedReplyTitle(names: readonly string[], group: boolean): string {
  const unique = [...new Set(names.filter(Boolean))];
  if (!group || unique.length === 0) return t("failedReply.title");
  if (unique.length === 1) return t("failedReply.titleOne", { name: unique[0]! });
  if (unique.length === 2) return t("failedReply.titleTwo", { first: unique[0]!, second: unique[1]! });
  return t("failedReply.titleMore", { first: unique[0]!, second: unique[1]!, count: unique.length - 2 });
}

/** A sign-in the app can open for this engine. */
export function canOfferSignIn(kind: FailedReplyKind, engine: InstanceInfo | undefined): boolean {
  return kind === "signed_out" && offersSignIn(engine);
}
