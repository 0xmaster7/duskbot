// The surfaces' words, in the person's language, sent with each summary: the island and the dock load no language
// pack of their own. Keys here are the snapshot's `labels`; values with {name} or {count} are filled in on the surface.
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

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
} as const satisfies Record<string, LocaleKey>;

export type AmbientLabel = keyof typeof AMBIENT_LABELS;
export type AmbientLabels = Partial<Record<AmbientLabel, string>>;

export function ambientLabels(): Record<AmbientLabel, string> {
  return Object.fromEntries(Object.entries(AMBIENT_LABELS).map(([key, locale]) => [key, t(locale)])) as Record<AmbientLabel, string>;
}

/** A label with its {name} and {count} filled in; "" before the first summary brings the words. */
export function say(labels: AmbientLabels, key: AmbientLabel, params?: Record<string, string | number>): string {
  const template = labels[key] ?? "";
  return params ? template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : template;
}
