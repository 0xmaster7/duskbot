import { describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../contracts.ts";
import { announcesStep, asksToCarryOn, continueNote, createFinishGuard, finishReason, MAX_CONTINUES, planSteps, type FinishReason } from "./finish-guard.ts";

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
  const turn = (text: string, opts: { plan?: string; tools?: number; ok?: boolean; threadId?: string; after?: string } = {}) => {
    send({ type: "turn.started" }, opts.threadId);
    if (opts.plan) send({ type: "item.started", itemType: "tool", title: "TodoWrite", input: opts.plan }, opts.threadId);
    for (let i = 0; i < (opts.tools ?? 0); i += 1) send({ type: "item.started", itemType: "tool", title: "Read" }, opts.threadId);
    send({ type: "item.completed", itemType: "assistant_text", text }, opts.threadId);
    if (opts.after) send({ type: "item.started", itemType: "tool", title: opts.after }, opts.threadId);
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

  it("reads a step announced but not taken, and leaves waits, results and other questions alone", () => {
    for (const text of ["Let me check Amazon India's bestseller list for current prices.", "Found the three desks.\n\nNow I'll compare their warranties.", "Okay, let me pull the review counts.", "Here are the prices:"]) expect(announcesStep(text), text).toBe(true);
    for (const text of ["I'll check again once the deploy finishes.", "Let me know if you want the long version.", "The Redragon K552 is the best pick at ₹2,289.", "Let me check: want the wired one or the wireless one?", "I'll send the link at 9.", "Sources:"]) expect(announcesStep(text), text).toBe(false);
  });

  it("reads a last line that only asks whether to carry on, but never one about sending, buying or deleting", () => {
    for (const text of ["Slides 1 to 3 are done.\n\nShall I continue with the rest?", "Want me to keep going?", "Continue?"]) expect(asksToCarryOn(text), text).toBe(true);
    for (const text of ["Want me to continue and send it to the team?", "Should I proceed with booking the 08:10 train?", "Which subject line should go out?", "Shall I continue? Here is more text after."]) expect(asksToCarryOn(text), text).toBe(false);
  });

  it("carries on a turn that announced a step or asked to go on mid-work, with a note that grants nothing", () => {
    const h = harness();
    h.turn("Let me check Amazon India's bestseller list.", { tools: 2 });
    expect(h.lines).toEqual([{ kind: "next" }]);
    expect(h.carried[0]!.note).toBe(continueNote({ kind: "next" }));
    expect(continueNote({ kind: "next" })).toContain("still needs their yes");
    const asked = harness();
    asked.turn("Three of five suppliers checked. Shall I continue?", { tools: 4 });
    expect(asked.lines).toEqual([{ kind: "next" }]);
  });

  it("does not carry on a question asked before any work, the soul's own ask-first, or words a tool already answered", () => {
    expect(finishReason({ text: "Want me to continue?", tools: 0, plan: null })).toBeNull();
    const h = harness();
    h.turn("Pick one:", { tools: 1, after: "show_widget" });
    h.turn("Let me pull the prices.", { tools: 1, after: "WebSearch" });
    expect(h.carried).toEqual([]);
  });

  it("stops carrying on when a carry-on only announces again without running a tool", () => {
    const h = harness();
    h.turn("Let me check the prices.");
    expect(h.carried).toHaveLength(1);
    h.turn("Let me check the prices.");
    expect(h.carried).toHaveLength(1);
  });
});
