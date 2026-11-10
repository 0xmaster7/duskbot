import { useEffect, useRef, useState } from "react";

import type { MarkState } from "@/components/mascot-motion-mark";
import type { LiveStatus } from "@/state/turn-status";
import type { Message } from "@/state/store";

/** What a running turn's mark is about: the reply being written (the typing dots), the bot at work (its own mascot in
 * motion), or the quiet wait before a turn has done anything (the mascot and dots taking turns, reply-life.ts). */
export type PresenceKind = "typing" | "working" | "waiting";

/** A state the mark has just taken stays at least this long, so a short gap between two tools never flickers it. */
export const PRESENCE_HOLD_MS = 600;

/** Typing only while the reply's words come: text streaming, or the engine saying its answer has started. A turn that
 * ran a tool (or is running one) is at work until then, between its tools too; one that has done nothing yet waits. */
export function presenceKind({ writing, activity, worked }: { writing: boolean; activity: LiveStatus["activity"] | null | undefined; worked: boolean }): PresenceKind {
  if (writing || activity === "reply") return "typing";
  if (worked || (activity && activity !== "thinking")) return "working";
  return "waiting";
}

const WORKING_MARKS: Partial<Record<LiveStatus["activity"], MarkState>> = {
  read: "reading",
  fetch: "reading",
  web: "searching",
  search: "searching",
  command: "running",
  write: "coding",
  edit: "coding",
};

/** The mascot at work for a step; thinking between steps, or a tool we cannot name, is plain working. Never the dots. */
export function workingMark(activity: LiveStatus["activity"] | null | undefined): MarkState {
  return (activity && WORKING_MARKS[activity]) || "working";
}

/** Whether the newest turn has run a step: a tool row after the person's newest message. */
export function turnWorked(messages: readonly Message[]): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "user" && message.kind === "text") return false;
    if (message.kind === "activity" && message.tool) return true;
  }
  return false;
}

/** Typing is the bot itself, looking down at its words, as Grok Bot's mark does: the dots only open a turn. */
export const TYPING_MARK: MarkState = "streaming";

/** The kind to show now, given the one shown since `since`: a change waits until the shown one has held its time. */
export function heldPresence(shown: { kind: PresenceKind | null; since: number }, next: PresenceKind | null, now: number): { kind: PresenceKind | null; since: number } {
  if (next === shown.kind) return shown;
  // a turn starting or ending is never held back
  if (shown.kind === null || next === null || now - shown.since >= PRESENCE_HOLD_MS) return { kind: next, since: now };
  return shown;
}

/** `kind`, held: each state shows at least PRESENCE_HOLD_MS before the next takes over. */
export function useHeldPresence(kind: PresenceKind | null): PresenceKind | null {
  const shown = useRef<{ kind: PresenceKind | null; since: number }>({ kind, since: Date.now() });
  const [, wake] = useState(0);
  shown.current = heldPresence(shown.current, kind, Date.now());
  const pending = shown.current.kind !== kind;
  const due = shown.current.since + PRESENCE_HOLD_MS;
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => wake((tick) => tick + 1), Math.max(0, due - Date.now()));
    return () => clearTimeout(timer);
  }, [pending, due]);
  return shown.current.kind;
}
