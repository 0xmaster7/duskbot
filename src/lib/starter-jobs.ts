import type { LocaleKey } from "@/locales";
import { OUTBOUND_DEFAULT_CAP, type OutboundPolicy } from "../../shared/outbound";

export type StarterJobId = "inbox" | "price" | "trip" | "research";

export interface StarterJob {
  id: StarterJobId;
  label: LocaleKey;
  text: LocaleKey;
  /** The part of the sentence that is the person's to change, selected when the job is picked. */
  example?: LocaleKey;
}

/** The first run's jobs: each one a whole first ask that lands a result in one turn. */
export const STARTER_JOBS: readonly StarterJob[] = [
  { id: "inbox", label: "onboarding.start.job.inbox", text: "onboarding.start.job.inbox.text" },
  { id: "price", label: "onboarding.start.job.price", text: "onboarding.start.job.price.text", example: "onboarding.start.job.price.example" },
  { id: "trip", label: "onboarding.start.job.trip", text: "onboarding.start.job.trip.text", example: "onboarding.start.job.trip.example" },
  { id: "research", label: "onboarding.start.job.research", text: "onboarding.start.job.research.text", example: "onboarding.start.job.research.example" },
];

type Translate = (key: LocaleKey, values?: Record<string, string>) => string;

/** A picked job's sentence for the composer, and the range of its example to select so typing replaces it. */
export function jobDraft(job: StarterJob, t: Translate): { text: string; select: [number, number] } {
  const example = job.example ? t(job.example) : "";
  const text = t(job.text, { thing: example });
  const at = example ? text.indexOf(example) : -1;
  return { text, select: at >= 0 ? [at, at + example.length] : [text.length, text.length] };
}

export type AiLine =
  /** an AI of the person's own answered (or can't be tested and is trusted) */
  | "ready"
  /** an AI of their own is being sent its test message */
  | "checking"
  /** none of their own works, the free backup does: jobs run on it, and signing in stays one tap away */
  | "free"
  /** nothing can run a job yet: signing in is the one thing left */
  | "connect";

/** What the start screen says about the AI under the composer, and whether a job can start on it now. */
export function aiLine(own: { state: "testing" | "passed" | "failed" | "untestable" } | null, backupReady: boolean): AiLine {
  if (own?.state === "passed" || own?.state === "untestable") return "ready";
  if (own?.state === "testing") return "checking";
  return backupReady ? "free" : "connect";
}

/** A job can start while an AI is ready, being checked (the server picks what runs it), or the free backup is there. */
export function canStart(line: AiLine, text: string): boolean {
  return line !== "connect" && text.trim().length > 0;
}

/** What the first job saves on the bot that does it: anything that sends, posts or pays waits for a tap, unless the
 * person already chose a rule of their own. */
export function firstJobOutbound(current: OutboundPolicy | undefined): { outbound: OutboundPolicy } | Record<string, never> {
  return current ? {} : { outbound: { policy: "ask", dailyCap: OUTBOUND_DEFAULT_CAP } };
}
