// A turn that ends with steps of its own plan still open, or that agreed with a correction ("You're right") without a
// single tool call, is carried on by itself, at most twice for each message of the person's: the person should never
// have to type "continue". A turn waiting on the person, one ending on a question, a failed or stopped turn and a
// person's own next message all leave it alone.
import type { RuntimeEvent } from "../contracts.ts";

export const MAX_CONTINUES = 2;
const START_DELAY_MS = 400;

const PLAN_TOOL = /\b(?:todowrite|todo_write|write_todos|update_plan|updateplan|plan)\b/i;
const STATUS = /"status"\s*:\s*"(pending|in_progress|completed|cancelled)"/g;
const AGREED = /\b(?:you'?re|you are)\s+(?:absolutely\s+|completely\s+|totally\s+|quite\s+)?right\b/i;

export type FinishReason = { kind: "plan"; open: number; total: number } | { kind: "ack" };

/** Open and total steps in a plan tool's input, or null when it shows none (or is cut before them). */
export function planSteps(title: string | undefined, input: string | undefined): { open: number; total: number } | null {
  if (!PLAN_TOOL.test(title ?? "") || !input) return null;
  const statuses = [...input.matchAll(STATUS)].map((match) => match[1]);
  if (!statuses.length) return null;
  return { open: statuses.filter((status) => status === "pending" || status === "in_progress").length, total: statuses.length };
}

const endsOnQuestion = (text: string) => /\?\s*[)"'”]?\s*$/.test(text.trim());

/** Why a finished turn should carry on, or null. */
export function finishReason(turn: { text: string; tools: number; plan: { open: number; total: number } | null }): FinishReason | null {
  if (!turn.text.trim() || endsOnQuestion(turn.text)) return null;
  if (turn.plan && turn.plan.open > 0) return { kind: "plan", ...turn.plan };
  if (turn.tools === 0 && AGREED.test(turn.text)) return { kind: "ack" };
  return null;
}

export function continueNote(reason: FinishReason): string {
  return reason.kind === "plan"
    ? `[dusk bot: your plan still has ${reason.open} of ${reason.total} steps open and nobody asked you to stop. Carry on with the next open step now and finish the plan. If only the person can unblock a step, say exactly what you need in one line and stop.]`
    : "[dusk bot: you agreed with the person's correction but did not act on it. Redo the work now with the correction applied. If nothing needs redoing, say so in one short line.]";
}

export interface FinishGuardDeps {
  /** The bot of a one-on-one chat this may carry on, or null (a room, a routine's run, a fenced run). Asked when the turn
   * starts and again when it ends: a routine's run is already settled by the time its last turn completes. */
  botOf(threadId: string): string | null;
  /** Something waits on the person, a message of theirs is queued, or the thread is busy again. */
  held(threadId: string): boolean;
  /** Starts the next turn with a note only the bot reads. */
  carryOn(botId: string, threadId: string, note: string): Promise<unknown>;
  /** The quiet line the person sees, "Continuing: 2 of 5 steps left". */
  line(threadId: string, reason: FinishReason): void;
  later?: (run: () => void, ms: number) => void;
}

interface Turn { text: string; tools: number; plan: { open: number; total: number } | null; carriable: boolean }

export function createFinishGuard(deps: FinishGuardDeps) {
  const later = deps.later ?? ((run: () => void, ms: number) => { setTimeout(run, ms).unref?.(); });
  const turns = new Map<string, Turn>();
  /** Carry-ons since the person last wrote, by thread; the turn started next is ours while `ours` is set. */
  const carried = new Map<string, { count: number; ours: boolean }>();

  return {
    onEvent(event: RuntimeEvent): void {
      const { threadId } = event;
      if (event.type === "turn.started") {
        const state = carried.get(threadId);
        if (state?.ours) state.ours = false;
        else carried.delete(threadId);
        turns.set(threadId, { text: "", tools: 0, plan: null, carriable: deps.botOf(threadId) !== null });
        return;
      }
      const turn = turns.get(threadId);
      if (!turn) return;
      if (event.type === "item.started" && event.itemType === "tool") {
        turn.tools += 1;
        turn.plan = planSteps(event.title, event.input) ?? turn.plan;
      } else if (event.type === "item.completed" && event.itemType === "assistant_text") {
        turn.text = event.text;
      } else if (event.type === "turn.completed" || event.type === "session.exited") {
        turns.delete(threadId);
        if (event.type !== "turn.completed" || !event.ok || event.stopReason === "cancelled" || event.stopReason === "interrupted") return;
        const reason = finishReason(turn);
        const botId = reason && turn.carriable ? deps.botOf(threadId) : null;
        const state = carried.get(threadId) ?? { count: 0, ours: false };
        if (!reason || !botId || state.count >= MAX_CONTINUES) return;
        later(() => {
          if (deps.held(threadId)) return;
          carried.set(threadId, { count: state.count + 1, ours: true });
          deps.line(threadId, reason);
          deps.carryOn(botId, threadId, continueNote(reason)).catch(() => carried.delete(threadId));
        }, START_DELAY_MS);
      }
    },
  };
}

export type FinishGuard = ReturnType<typeof createFinishGuard>;
