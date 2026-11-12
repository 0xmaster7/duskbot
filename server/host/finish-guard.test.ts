import { describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../contracts.ts";
import { continueNote, createFinishGuard, finishReason, MAX_CONTINUES, planSteps, type FinishReason } from "./finish-guard.ts";

type Body = RuntimeEvent extends infer E ? E extends RuntimeEvent ? Omit<E, "eventId" | "provider" | "threadId" | "createdAt"> : never : never;
const PLAN = JSON.stringify({ todos: [{ content: "Read", status: "completed" }, { content: "Draft", status: "in_progress" }, { content: "Send", status: "pending" }] });

function harness(held = false) {
  const carried: Array<{ botId: string; threadId: string; note: string }> = [];
  const lines: FinishReason[] = [];
  let isHeld = held;
  const guard = createFinishGuard({
    botOf: (threadId) => (threadId.startsWith("room") ? null : "bot-1"),
    held: () => isHeld,
    carryOn: async (botId, threadId, note) => { carried.push({ botId, threadId, note }); },
    line: (_threadId, reason) => lines.push(reason),
    later: (run) => run(),
  });
  const send = (body: Body, threadId = "t1") => guard.onEvent({ eventId: "e", provider: "fake", threadId, createdAt: "", ...body } as RuntimeEvent);
  const turn = (text: string, opts: { plan?: string; tools?: number; ok?: boolean; threadId?: string } = {}) => {
    send({ type: "turn.started" }, opts.threadId);
    if (opts.plan) send({ type: "item.started", itemType: "tool", title: "TodoWrite", input: opts.plan }, opts.threadId);
    for (let i = 0; i < (opts.tools ?? 0); i += 1) send({ type: "item.started", itemType: "tool", title: "Read" }, opts.threadId);
    send({ type: "item.completed", itemType: "assistant_text", text }, opts.threadId);
    send({ type: "turn.completed", ok: opts.ok ?? true }, opts.threadId);
  };
  return { carried, lines, turn, hold: (on: boolean) => { isHeld = on; } };
}

describe("finish guard", () => {
  it("reads open steps from a plan tool's input", () => {
    expect(planSteps("TodoWrite", PLAN)).toEqual({ open: 2, total: 3 });
    expect(planSteps("update_plan", '{"plan":[{"step":"a","status":"completed"}]}')).toEqual({ open: 0, total: 1 });
    expect(planSteps("Bash", PLAN)).toBeNull();
  });

  it("carries a turn on when its plan has open steps, at most twice for one message of the person's", () => {
    const h = harness();
    h.turn("Drafted the reply.", { plan: PLAN });
    expect(h.carried).toHaveLength(1);
    expect(h.carried[0]!.note).toBe(continueNote({ kind: "plan", open: 2, total: 3 }));
    expect(h.lines).toEqual([{ kind: "plan", open: 2, total: 3 }]);
    h.turn("Still going.", { plan: PLAN });
    h.turn("Still going.", { plan: PLAN });
    expect(h.carried).toHaveLength(MAX_CONTINUES);

    h.turn("New ask from the person, half done.", { plan: PLAN });
    expect(h.carried).toHaveLength(MAX_CONTINUES + 1);
  });

  it("carries on after agreeing to a correction with no tool call, and not once it acted", () => {
    const h = harness();
    h.turn("You're right, I stopped early.");
    expect(h.carried.map((one) => one.note)).toEqual([continueNote({ kind: "ack" })]);
    const other = harness();
    other.turn("You're right. I fixed the date in the file.", { tools: 1 });
    expect(other.carried).toEqual([]);
  });

  it("leaves alone a question, a failed turn, a room, and a thread held for the person", () => {
    expect(finishReason({ text: "You're right. Want me to redo it?", tools: 0, plan: null })).toBeNull();
    const h = harness();
    h.turn("Drafted it.", { plan: PLAN, ok: false });
    h.turn("Drafted it.", { plan: PLAN, threadId: "room-1" });
    expect(h.carried).toEqual([]);
    const held = harness(true);
    held.turn("Drafted it.", { plan: PLAN });
    expect(held.carried).toEqual([]);
  });

  it("never carries on a routine's run, though the run is settled by the time its turn completes", () => {
    let routineRunning = true;
    const carried: string[] = [];
    const guard = createFinishGuard({
      botOf: () => (routineRunning ? null : "bot-1"), held: () => false,
      carryOn: async (_botId, _threadId, note) => { carried.push(note); }, line: () => {}, later: (run) => run(),
    });
    const send = (body: Body) => guard.onEvent({ eventId: "e", provider: "fake", threadId: "routine-thread", createdAt: "", ...body } as RuntimeEvent);
    send({ type: "turn.started" });
    send({ type: "item.completed", itemType: "assistant_text", text: "You're right, the report is fine." });
    routineRunning = false;
    send({ type: "turn.completed", ok: true });
    expect(carried).toEqual([]);
  });
});
