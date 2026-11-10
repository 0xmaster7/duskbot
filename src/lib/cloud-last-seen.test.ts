// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "../state/store";
import { LAST_SEEN_MESSAGES, lastSeenSnapshot, useHeldSend } from "./cloud-last-seen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const message = (n: number, extra: Partial<Message> = {}) => ({ id: `m${n}`, role: n % 2 ? "bot" : "user", kind: "text", text: `line ${n}`, at: n, ...extra }) as Message;
const bot = (id: string, messages: Message[]) => ({ id, threadId: `t-${id}`, name: id, color: "green", messages }) as unknown as Bot;

describe("the last-seen snapshot", () => {
  it("puts the open bot first, then the newest, with only plain messages of each open chat", () => {
    const snapshot = lastSeenSnapshot([bot("old", [message(1)]), bot("new", [message(9)]), bot("open", [message(2), message(3, { kind: "activity" }), message(4, { text: "  " })])], "open");
    expect(snapshot.bots.map((entry) => entry.id)).toEqual(["open", "new", "old"]);
    expect(snapshot.bots[0]!.messages).toEqual([{ id: "m2", role: "user", text: "line 2", at: 2 }]);
    const long = lastSeenSnapshot([bot("a", Array.from({ length: LAST_SEEN_MESSAGES + 3 }, (_, n) => message(n + 1)))], null);
    expect(long.bots[0]!.messages).toHaveLength(LAST_SEEN_MESSAGES);
    expect(long.bots[0]!.messages.at(-1)!.id).toBe(`m${LAST_SEEN_MESSAGES + 3}`);
  });
});

describe("the held message", () => {
  function Probe({ state, dispatch, home }: { state: Parameters<typeof useHeldSend>[0]; dispatch: Parameters<typeof useHeldSend>[1]; home: Parameters<typeof useHeldSend>[2] }) {
    useHeldSend(state, dispatch, home);
    return null;
  }
  it("is sent once its bot's chats are here, to that chat, with its own send id", async () => {
    const held = { botId: "scout", threadId: "t-scout", text: "go", sendId: "send-0123456789" };
    const home = { takeHeld: vi.fn(async () => held) }, dispatch = vi.fn();
    const host = document.createElement("div"), root = createRoot(host);
    await act(async () => { root.render(createElement(Probe, { state: { bots: [], hydrated: undefined }, dispatch, home })); });
    expect(home.takeHeld).not.toHaveBeenCalled();
    const state = { bots: [bot("scout", [])], hydrated: true as const };
    await act(async () => { root.render(createElement(Probe, { state, dispatch, home })); });
    await act(async () => { root.render(createElement(Probe, { state: { ...state }, dispatch, home })); });
    expect(home.takeHeld).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls).toEqual([[{ type: "select", id: "scout" }], [{ type: "send", botId: "scout", threadId: "t-scout", text: "go", sendId: "send-0123456789" }]]);
    await act(async () => root.unmount());
  });
});
