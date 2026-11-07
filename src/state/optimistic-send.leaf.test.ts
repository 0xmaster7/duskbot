import { describe, expect, it } from "vitest";
import { initialState, reducer, visibleMessages, type Bot, type Message } from "./store";

const rows: Message[] = [
  { id: "a", role: "user", kind: "text", text: "hi", at: 1, parentId: null },
  { id: "b", role: "bot", kind: "text", text: "hello", at: 2, parentId: "a" },
];
const bot = (activeLeafId: string | null | undefined): Bot => ({
  id: "bot", threadId: "thread", name: "Nova", title: "", description: "", notifications: true, color: "green", unread: false,
  busy: false, activity: "idle", modelSelection: { instanceId: "default", model: "m" }, approvalMode: "ask", alwaysAllow: [],
  messages: rows, activeLeafId,
} as Bot);
const sent = (activeLeafId: string | null | undefined) => {
  const state = reducer({ ...initialState, bots: [bot(activeLeafId)], selectedId: "bot" }, { type: "send", botId: "bot", threadId: "thread", text: "next", sendId: "s1" });
  return visibleMessages(state.bots[0]!).map((message) => message.id);
};

describe("a send's optimistic row", () => {
  it("joins the conversation on screen when the held leaf is unknown, so the chat never shows the send alone", () => {
    expect(sent(undefined)).toEqual(["a", "b", "optimistic-s1"]);
    expect(sent(null)).toEqual(["a", "b", "optimistic-s1"]);
    // a leaf the transcript does not hold (a pointer that came before its message)
    expect(sent("not-loaded")).toEqual(["a", "b", "optimistic-s1"]);
  });

  it("follows the held leaf when it is a loaded message", () => {
    expect(sent("b")).toEqual(["a", "b", "optimistic-s1"]);
    // an older branch the person switched to
    expect(sent("a")).toEqual(["a", "optimistic-s1"]);
  });
});
