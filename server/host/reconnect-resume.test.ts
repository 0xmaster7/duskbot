import { describe, expect, it } from "vitest";

import type { RuntimeEvent } from "../contracts.ts";
import { createReconnectResume, RECONNECT_WAIT_MS, reconnectNote, refusedApps, type NeedsReconnect } from "./reconnect-resume.ts";

type Body = RuntimeEvent extends infer E ? E extends RuntimeEvent ? Omit<E, "eventId" | "provider" | "threadId" | "createdAt"> : never : never;
const REFUSAL = "Notion refused its sign-in (it expired or was revoked), so nothing was done. Ask the person to reconnect Notion in Connect apps, then try again; retrying before that won't work.";

function harness(needing: NeedsReconnect[] = [{ server: "notion", label: "Notion" }]) {
  const carried: Array<{ botId: string; threadId: string; note: string }> = [];
  const lines: string[] = [];
  let held = false;
  let clock = 1_000;
  const resume = createReconnectResume({
    botOf: (threadId) => (threadId.startsWith("room") ? null : "bot-1"),
    needing: () => needing,
    held: () => held,
    carryOn: async (botId, threadId, note) => { carried.push({ botId, threadId, note }); },
    line: (threadId) => lines.push(threadId),
    now: () => clock,
    later: (run) => run(),
  });
  const send = (body: Body, threadId = "t1") => resume.onEvent({ eventId: "e", provider: "fake", threadId, createdAt: "", ...body } as RuntimeEvent);
  const turn = (opts: { output?: string; text: string; threadId?: string; stopReason?: "cancelled" }) => {
    send({ type: "turn.started" }, opts.threadId);
    if (opts.output !== undefined) {
      send({ type: "item.started", itemType: "tool", title: "mcp__notion__notion-create-pages" }, opts.threadId);
      send({ type: "item.completed", itemType: "tool", ok: false, output: opts.output }, opts.threadId);
    }
    send({ type: "item.completed", itemType: "assistant_text", text: opts.text }, opts.threadId);
    send({ type: "turn.completed", ok: true, ...(opts.stopReason ? { stopReason: opts.stopReason } : {}) } as Body, opts.threadId);
  };
  return { resume, carried, lines, turn, send, hold: (on: boolean) => { held = on; }, tick: (ms: number) => { clock += ms; } };
}

describe("reconnect resume", () => {
  it("reads the apps a refusal asks to reconnect", () => {
    expect(refusedApps(REFUSAL)).toEqual(["notion"]);
    expect(refusedApps("HTTP 401\n\nLinear refused the sign-in: it expired or was revoked. Ask the person to reconnect Linear in Connect apps.")).toEqual(["linear"]);
    expect(refusedApps("Page created.")).toEqual([]);
  });

  it("carries the task on once the refused app is reconnected, once, with a quiet line", () => {
    const h = harness();
    h.turn({ output: REFUSAL, text: "Notion needs reconnecting in Connect apps; I'll finish once it is." });
    expect(h.resume.waiting()).toEqual(["t1"]);
    h.resume.reconnected("linear");
    expect(h.carried).toEqual([]);
    h.resume.reconnected("notion");
    expect(h.lines).toEqual(["t1"]);
    expect(h.carried).toEqual([{ botId: "bot-1", threadId: "t1", note: reconnectNote(["Notion"]) }]);
    h.resume.reconnected("notion");
    expect(h.carried).toHaveLength(1);
  });

  it("waits on an app the last words name when its sign-in is one to redo, even with no call refused", () => {
    const h = harness();
    h.turn({ text: "I drafted the checklist. Notion needs reconnecting in Connect apps, then I'll add it there." });
    h.resume.reconnected("notion");
    expect(h.carried).toHaveLength(1);
  });

  it("leaves a turn alone that never hit the app, or whose app is fine now", () => {
    const fine = harness([]);
    fine.turn({ output: REFUSAL, text: "Done." });
    expect(fine.resume.waiting()).toEqual([]);
    const h = harness();
    h.turn({ text: "Here is your summary." });
    expect(h.resume.waiting()).toEqual([]);
  });

  it("does nothing in a room, after a cancel, once the person wrote again, or a day later", () => {
    const room = harness();
    room.turn({ output: REFUSAL, text: "Notion needs reconnecting.", threadId: "room-1" });
    expect(room.resume.waiting()).toEqual([]);
    const cancelled = harness();
    cancelled.turn({ output: REFUSAL, text: "", stopReason: "cancelled" });
    expect(cancelled.resume.waiting()).toEqual([]);
    const moved = harness();
    moved.turn({ output: REFUSAL, text: "Notion needs reconnecting." });
    moved.turn({ text: "Sure, here is the weather." });
    moved.resume.reconnected("notion");
    expect(moved.carried).toEqual([]);
    const late = harness();
    late.turn({ output: REFUSAL, text: "Notion needs reconnecting." });
    late.tick(RECONNECT_WAIT_MS + 1);
    late.resume.reconnected("notion");
    expect(late.carried).toEqual([]);
  });

  it("does not start over a busy chat, and its own carry-on keeps no stale wait", () => {
    const h = harness();
    h.turn({ output: REFUSAL, text: "Notion needs reconnecting." });
    h.hold(true);
    h.resume.reconnected("notion");
    expect(h.carried).toEqual([]);
    expect(h.resume.waiting()).toEqual([]);
  });
});
