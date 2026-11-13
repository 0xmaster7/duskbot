import { describe, expect, it } from "vitest";
import { MOOD_EMOJI, dockOrder, finishedSince, focusBot, islandBots, moodOf, rankBots, shortAgo, waitingCount } from "./mood";
import type { AmbientBot, AmbientStatus } from "./types";

const bot = (id: string, status: AmbientStatus, at = 0, fields: Partial<AmbientBot> = {}): AmbientBot => ({
  id, threadId: `t-${id}`, name: id, color: "blue", body: null, face: null, avatar: null, status, detail: "", line: "", at, unread: status === "done", asks: 0, approval: null,
  waits: status === "needs-you" ? "other" : null, question: null, ...fields,
});

describe("the island's mood", () => {
  it("puts the person first, then a failure, a fresh finish and what the busiest bot is doing", () => {
    expect(moodOf([])).toBe("idle");
    expect(moodOf([bot("a", "idle"), bot("b", "done")])).toBe("done");
    expect(moodOf([bot("a", "thinking"), bot("b", "done")])).toBe("thinking");
    expect(moodOf([bot("a", "thinking"), bot("b", "working")])).toBe("working");
    expect(moodOf([bot("a", "working"), bot("b", "talking")])).toBe("talking");
    expect(moodOf([bot("a", "talking")], true)).toBe("celebrate");
    expect(moodOf([bot("a", "talking"), bot("b", "error")], true)).toBe("error");
    expect(moodOf([bot("a", "error"), bot("b", "needs-you")], true)).toBe("needs-you");
    expect(new Set(Object.values(MOOD_EMOJI)).size).toBe(Object.keys(MOOD_EMOJI).length);
  });

  it("cheers a bot whose turn just ended, and nobody who was resting already", () => {
    expect(finishedSince(null, [bot("a", "done")])).toEqual([]);
    expect(finishedSince([bot("a", "working"), bot("b", "idle"), bot("c", "talking")], [bot("a", "done"), bot("b", "done"), bot("c", "needs-you")])).toEqual(["a"]);
  });

  it("lists who needs the person first and keeps the dock in the person's order", () => {
    const bots = [bot("idle", "idle", 9), bot("busy", "working", 1), bot("ask", "needs-you", 0), bot("new", "done", 5), bot("old", "done", 2)];
    expect(rankBots(bots).map((entry) => entry.id)).toEqual(["ask", "busy", "new", "old", "idle"]);
    expect(focusBot(bots)?.id).toBe("ask");
    expect(focusBot([])).toBeNull();
    expect(dockOrder(bots, ["old", "gone", "ask"]).map((entry) => entry.id)).toEqual(["old", "ask", "idle", "busy", "new"]);
  });

  it("puts a question first, then an approval, then any other ask, then a failure, however recent the others are", () => {
    const bots = [
      bot("failed", "error", 9),
      bot("signin", "needs-you", 8),
      bot("approve", "needs-you", 7, { waits: "approval" }),
      bot("busy", "working", 6),
      bot("question", "needs-you", 1, { waits: "question" }),
    ];
    expect(rankBots(bots).map((entry) => entry.id)).toEqual(["question", "approve", "signin", "failed", "busy"]);
    expect(focusBot(bots)?.id).toBe("question");
  });

  it("counts each ask and each failure as waiting, so the island can say how many more there are", () => {
    expect(waitingCount([bot("a", "needs-you", 0, { asks: 3 }), bot("b", "needs-you"), bot("c", "error"), bot("d", "working"), bot("e", "done")])).toBe(5);
    expect(waitingCount([bot("a", "working")])).toBe(0);
  });

  it("says how long ago in the person's language", () => {
    const now = 10_000_000;
    expect(shortAgo(0, now, "en", "now")).toBe("");
    expect(shortAgo(now - 10_000, now, "en", "now")).toBe("now");
    expect(shortAgo(now - 4 * 60_000, now, "en", "now")).toBe("4m");
    expect(shortAgo(now - 3 * 3_600_000, now, "en", "now")).toBe("3h");
    expect(shortAgo(now - 2 * 86_400_000, now, "en", "now")).toBe("2d");
  });
});

describe("the island's bots", () => {
  it("rests a bot stopped on a sign-in, a password, an app to connect or an ask with no card, and keeps the rest", () => {
    const waiting = (id: string, waits: AmbientBot["waits"]) => bot(id, "needs-you", 1, { waits, asks: 1, detail: "sign in to pastebin.com" });
    const shown = islandBots([
      waiting("signin", "sign-in"), waiting("key", "password"), waiting("app", "connect"), waiting("other", "other"), waiting("bare", null),
      waiting("question", "question"), waiting("approval", "approval"), waiting("review", "review"), bot("busy", "working"),
    ]);
    expect(shown.map((one) => [one.id, one.status])).toEqual([
      ["signin", "idle"], ["key", "idle"], ["app", "idle"], ["other", "idle"], ["bare", "idle"],
      ["question", "needs-you"], ["approval", "needs-you"], ["review", "needs-you"], ["busy", "working"],
    ]);
    expect(shown.slice(0, 5).every((one) => one.asks === 0 && one.waits === null && one.detail === "")).toBe(true);
    expect(moodOf(islandBots([waiting("signin", "sign-in"), bot("busy", "working")]))).toBe("working");
    expect(waitingCount(islandBots([waiting("signin", "sign-in"), waiting("question", "question")]))).toBe(1);
  });
});
