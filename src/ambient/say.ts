// The surfaces' side of labels.ts: the words arrive with each summary, so this never loads a language pack.
export type AmbientLabel =
  | "idle" | "thinking" | "working" | "talking" | "needs-you" | "done" | "error" | "now" | "open" | "reply" | "replyTo" | "send"
  | "allow" | "deny" | "newBot" | "quiet" | "quietHint" | "empty" | "emptyHint" | "island" | "dock" | "reorder" | "stop" | "more"
  | "answer" | "openShort" | "sent" | "dismiss" | "recent" | "waiting"
  | "wakeQuestion" | "wakeApproval" | "wakeSignIn" | "wakeReview" | "wakeNeedsYou" | "wakeFailed" | "wakeLongDone" | "wakeScheduled";
export type AmbientLabels = Partial<Record<AmbientLabel, string>>;

/** A label with its {name} and {count} filled in; "" before the first summary brings the words. */
export function say(labels: AmbientLabels, key: AmbientLabel, params?: Record<string, string | number>): string {
  const template = labels[key] ?? "";
  return params ? template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : template;
}
