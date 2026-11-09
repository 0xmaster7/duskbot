import { describe, expect, it } from "vitest";
import type { Bot, Message, Task } from "@/state/store";
import { botActivityAt, latestActivityFirst } from "./sidebar-order";

const said = (at: number, role: Message["role"] = "bot"): Message => ({ id: `m${at}`, at, role, kind: "text", text: "hi" }) as Message;
const bot = (extra: Partial<Bot> = {}): Bot => ({ id: "ada", threadId: "open", messages: [], ...extra }) as Bot;
const task = (threadId: string, extra: Partial<Task> = {}): Task => ({ threadId, title: "t", createdAt: 1, ...extra });

describe("botActivityAt", () => {
  it("counts the bot's own newest message, not the person's send after it", () => {
    expect(botActivityAt(bot({ messages: [said(100), said(200, "user")], tasks: [task("open", { updatedAt: 200 })] }))).toBe(100);
  });

  it("moves to the turn's start while the bot works, and drops it once the turn is over", () => {
    const sent = { messages: [said(100), said(200, "user")] };
    expect(botActivityAt(bot({ ...sent, busy: true, turnStartedAt: 250 }))).toBe(250);
    expect(botActivityAt(bot({ ...sent, busy: false, turnStartedAt: 250 }))).toBe(100);
    expect(botActivityAt(bot({ ...sent, tasks: [task("other", { busy: true, turnStartedAt: 300 })] }))).toBe(300);
  });

  it("reads another conversation's stamp, and the open one's only while its messages are not held", () => {
    expect(botActivityAt(bot({ messages: [said(100)], tasks: [task("open", { updatedAt: 900 }), task("other", { updatedAt: 400 })] }))).toBe(400);
    expect(botActivityAt(bot({ tasks: [task("open", { updatedAt: 900 })] }))).toBe(900);
    expect(botActivityAt(bot({ tasks: [task("run", { updatedAt: 999, routineRunId: "r" })] }))).toBe(0);
  });
});

describe("latestActivityFirst", () => {
  it("puts the latest first and keeps the saved order among ties", () => {
    const at: Record<string, number> = { a: 0, b: 5, c: 0, d: 9 };
    expect(latestActivityFirst(["a", "b", "c", "d"], (id) => at[id]!)).toEqual(["d", "b", "a", "c"]);
  });
});
