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

describe("a snapshot that left before a send and lands after it", () => {
  // seen on a slow link: the chat's snapshot was asked for just before the send and answered 2.5 s later, with the
  // thread as it was before the send; the send, its server copy and the reply then never showed
  const hydrateBehind = (state: ReturnType<typeof reducer>) => reducer(state, {
    type: "hydrate", bots: [bot("b")], groups: [], computerControl: {}, loadedThreads: ["thread"],
  });
  const ids = (state: ReturnType<typeof reducer>) => visibleMessages(state.bots[0]!).map((message) => message.id);
  const copy: Message = { id: "u1", role: "user", kind: "text", text: "next", at: 3, parentId: "b", sendId: "s1" };
  const reply: Message = { id: "r1", role: "bot", kind: "text", text: "ok", at: 4, parentId: "u1" };

  it("keeps the send on screen, and its server copy and the reply follow it", () => {
    let state = reducer({ ...initialState, bots: [bot("b")], selectedId: "bot" }, { type: "send", botId: "bot", threadId: "thread", text: "next", sendId: "s1" });
    state = hydrateBehind(state);
    expect(ids(state)).toEqual(["a", "b", "optimistic-s1"]);
    state = reducer(state, { type: "messageAdded", threadId: "thread", message: copy });
    state = reducer(state, { type: "messageAdded", threadId: "thread", message: reply });
    expect(ids(state)).toEqual(["a", "b", "u1", "r1"]);
  });

  it("a send's server copy parented on the leaf takes the leaf even when the leaf had left the optimistic row", () => {
    const optimistic: Message = { id: "optimistic-s1", role: "user", kind: "text", text: "next", at: 3, parentId: "b", sendId: "s1" };
    let state = reducer(initialState, { type: "hydrate", bots: [{ ...bot("b"), messages: [...rows, optimistic] }], groups: [], computerControl: {}, loadedThreads: ["thread"] });
    state = reducer(state, { type: "messageAdded", threadId: "thread", message: copy });
    state = reducer(state, { type: "messageAdded", threadId: "thread", message: reply });
    expect(ids(state)).toEqual(["a", "b", "u1", "r1"]);
  });

  it("still takes the server's leaf when it names another branch", () => {
    const other: Message = { id: "c", role: "bot", kind: "text", text: "another answer", at: 2, parentId: "a" };
    const branched = (leaf: string) => ({ ...bot(leaf), messages: [...rows, other] });
    let state = reducer({ ...initialState, bots: [branched("b")], selectedId: "bot" }, { type: "send", botId: "bot", threadId: "thread", text: "next", sendId: "s1" });
    state = reducer(state, { type: "hydrate", bots: [branched("c")], groups: [], computerControl: {}, loadedThreads: ["thread"] });
    expect(state.bots[0]!.activeLeafId).toBe("c");
  });
});
