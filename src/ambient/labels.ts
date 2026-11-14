// The surfaces' words, in the person's language, sent with each summary: the island and the dock load no language
// pack of their own. Keys here are the snapshot's `labels`; values with {name} or {count} are filled in on the surface.
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { AmbientLabel } from "./say";

export const AMBIENT_LABELS = {
  idle: "ambient.status.idle",
  thinking: "ambient.status.thinking",
  working: "ambient.status.working",
  talking: "ambient.status.talking",
  "needs-you": "ambient.status.needsYou",
  done: "ambient.status.done",
  error: "ambient.status.error",
  now: "ambient.now",
  open: "ambient.open",
  reply: "ambient.reply",
  replyTo: "ambient.replyTo",
  send: "ambient.send",
  allow: "ambient.allow",
  deny: "ambient.deny",
  newBot: "ambient.newBot",
  quiet: "ambient.quiet",
  quietHint: "ambient.quietHint",
  empty: "ambient.empty",
  emptyHint: "ambient.emptyHint",
  island: "ambient.island",
  dock: "ambient.dock",
  reorder: "ambient.reorder",
  stop: "ambient.stop",
  more: "ambient.more",
  answer: "ambient.answer",
  openShort: "ambient.openShort",
  sent: "ambient.sent",
  dismiss: "ambient.dismiss",
  recent: "ambient.recent",
  waiting: "ambient.status.waiting",
  wakeQuestion: "ambient.wake.question",
  wakeApproval: "ambient.wake.approval",
  wakeSignIn: "ambient.wake.signIn",
  wakeReview: "ambient.wake.review",
  wakeNeedsYou: "ambient.wake.needsYou",
  wakeFailed: "ambient.wake.failed",
  wakeLongDone: "ambient.wake.longDone",
  wakeScheduled: "ambient.wake.scheduled",
} as const satisfies Record<AmbientLabel, LocaleKey>;

export type { AmbientLabel, AmbientLabels } from "./say";

export function ambientLabels(): Record<AmbientLabel, string> {
  return Object.fromEntries(Object.entries(AMBIENT_LABELS).map(([key, locale]) => [key, t(locale)])) as Record<AmbientLabel, string>;
}
