import { describe, expect, it } from "vitest";
import { WAKE, WAKE_EMOJI, WAKE_MOMENT, wakeCount, wakeOf, wakesOf } from "./wake";
import type { AmbientBot } from "./types";

const bot = (id: string, fields: Partial<AmbientBot> = {}): AmbientBot => ({
  id, threadId: `t-${id}`, name: id, color: "blue", body: null, face: null, avatar: null, status: "idle", detail: "", line: "", at: 1, unread: false, asks: 0,
  approval: null, waits: null, question: null, ...fields,
});
const none = new Set<string>();

describe("when the island wakes", () => {
  it("stays quiet for a bot at work, a quick reply, a resting bot and anything the person watches", () => {
    for (const status of ["idle", "thinking", "working", "talking"] as const) expect(wakeOf(bot("a", { status }), none)).toBeNull();
    expect(wakeOf(bot("a", { status: "done", unread: true, ran: 40_000 }), none)).toBeNull();
    expect(wakeOf(bot("a", { status: "done", unread: true }), none)).toBeNull();
    expect(wakeOf(bot("a", { status: "needs-you", waits: "question", quiet: true }), none)).toBeNull();
  });

  it("wakes for each kind of ask, a failure, a long task done and a routine's result, each with its own emoji and moment", () => {
    const cases: Array<[Partial<AmbientBot>, string]> = [
      [{ status: "needs-you", waits: "question" }, "question"],
      [{ status: "needs-you", waits: "approval" }, "approval"],
      [{ status: "needs-you", waits: "sign-in" }, "sign-in"],
      [{ status: "needs-you", waits: "password" }, "sign-in"],
      [{ status: "needs-you", waits: "connect" }, "sign-in"],
      [{ status: "needs-you", waits: "review" }, "review"],
      [{ status: "needs-you", waits: "other" }, "needs-you"],
      [{ status: "error", unread: true }, "failed"],
      [{ status: "done", unread: true, ran: WAKE.longTaskMs }, "long-done"],
      [{ status: "done", unread: true, scheduled: true }, "scheduled"],
    ];
    for (const [fields, kind] of cases) expect(wakeOf(bot("a", fields), none)).toBe(kind);
    expect(new Set(Object.values(WAKE_EMOJI)).size).toBe(Object.keys(WAKE_EMOJI).length);
    expect(WAKE_EMOJI["long-done"]).not.toBe("✅");
    expect([WAKE_MOMENT.question, WAKE_MOMENT["long-done"], WAKE_MOMENT.failed]).toEqual(["nudge", "celebrate", "worried"]);
  });

  it("goes back to sleep once a reply or failure is seen", () => {
    const done = bot("a", { status: "done", unread: true, ran: WAKE.longTaskMs * 2, at: 7 });
    expect(wakeOf(done, new Set(["a:done:7"]))).toBeNull();
    expect(wakeOf(bot("b", { status: "error", unread: true, at: 3 }), new Set(["b:error:3"]))).toBeNull();
  });

  it("puts asks first, then failures, then finishes, and counts each ask", () => {
    const wakes = wakesOf([
      bot("Done", { status: "done", unread: true, ran: WAKE.longTaskMs, at: 9 }),
      bot("Busy", { status: "working" }),
      bot("Broke", { status: "error", unread: true }),
      bot("Asks", { status: "needs-you", waits: "approval", asks: 2 }),
      bot("Q", { status: "needs-you", waits: "question", asks: 1 }),
    ], none);
    expect(wakes.map((wake) => wake.bot.id)).toEqual(["Q", "Asks", "Broke", "Done"]);
    expect(wakeCount(wakes)).toBe(5);
  });
});
