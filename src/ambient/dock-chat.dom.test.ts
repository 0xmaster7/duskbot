// @vitest-environment happy-dom
// Chatting from the dock's card: instant and steady (no doubled or flickering messages, the mascots left alone while a
// reply streams), one card from bot to bot with each chat where it was left, and nothing opened by focus coming back.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_MAX_H, CHAT_SHARE, DWELL_MS, Dock, keepHistory } from "./Dock";
import { sentSince } from "./MiniChat";
import type { AmbientAct, AmbientBot, AmbientBridge, AmbientMessage, AmbientSnapshot, DockLayout } from "./types";

const marks = vi.hoisted(() => ({ drawn: 0 }));
vi.mock("./shared", async (original) => {
  const shared = await original<typeof import("./shared")>();
  return { ...shared, BotMark: (props: Parameters<typeof shared.BotMark>[0]) => { marks.drawn += 1; return shared.BotMark(props); } };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const bot = (id: string, fields: Partial<AmbientBot> = {}): AmbientBot => ({
  id, threadId: `t-${id}`, name: id, color: "blue", body: null, face: null, avatar: null, status: "idle", detail: "", line: "", at: 1, unread: false, asks: 0,
  approval: null, waits: null, question: null, ...fields,
});
const msg = (id: string, from: "you" | "bot", text: string): AmbientMessage => ({ id, from, text, at: 1 });
const wait = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
const LABELS = { send: "Send", replyTo: "Reply to {name}" };
const LAYOUT: DockLayout = { surface: "dock", width: 408, height: 945, body: 853, top: 46, dock: { cell: 56, tile: 36, column: 64, open: 404, pad: 8, ear: 18, sliver: 6, margin: 28, overhang: 4 }, order: [] };

async function mount(bots: AmbientBot[]) {
  let feed: (snapshot: AmbientSnapshot) => void = () => {};
  let place: (layout: DockLayout) => void = () => {};
  const acts: AmbientAct[] = [];
  const bridge: AmbientBridge = {
    surface: "dock", onState: (cb) => { feed = cb; return () => {}; }, onLayout: (cb) => { place = cb as typeof place; return () => {}; }, pointer() {}, open() {},
    act: (next) => acts.push(next), order() {}, ready() {},
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(Dock, { bridge })));
  await act(async () => place(LAYOUT));
  const show = (next: AmbientBot[]) => act(async () => feed({ lang: "en", labels: LABELS, bots: next }));
  await show(bots);
  const hover = (id: string) => act(async () => {
    host.querySelector(`[data-row="${id}"]`)!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: 470 }));
  });
  const card = () => host.querySelector(".amb-card")!;
  const bubbles = () => [...card().querySelectorAll(".amb-bubble-msg")].map((node) => `${node.getAttribute("data-from")}${node.hasAttribute("data-pending") ? "?" : ""}${node.hasAttribute("data-streaming") ? "~" : ""}:${node.textContent}`);
  const type = async (text: string) => {
    const input = card().querySelector<HTMLInputElement>(".amb-reply-input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => card().querySelector<HTMLFormElement>(".amb-reply")!.requestSubmit());
  };
  return { host, acts, show, hover, card, bubbles, type, unmount: () => act(async () => root.unmount()) };
}

afterEach(() => { document.body.innerHTML = ""; });

describe("chatting from the dock", () => {
  it("shows a sent message at once and hands it over to the chat's copy even when that comes back reformatted, never both", async () => {
    const said = [msg("m1", "bot", "Paid on Saturday.")];
    const { acts, show, hover, bubbles, type, unmount } = await mount([bot("Ada", { chat: said })]);
    await hover("Ada");
    await wait(DWELL_MS + 60);
    await type("**check** the   next one");
    expect(acts.at(-1)).toMatchObject({ kind: "reply", text: "**check** the   next one" });
    expect(bubbles()).toEqual(["bot:Paid on Saturday.", "you?:**check** the   next one"]);
    // the chat's own copy, as plain text: the sent copy gives way in that very summary
    const echoed = [...said, msg("m2", "you", "check the next one")];
    await show([bot("Ada", { status: "working", chat: echoed })]);
    expect(bubbles()).toEqual(["bot:Paid on Saturday.", "you:check the next one"]);
    await show([bot("Ada", { status: "talking", streaming: "It is due on", chat: echoed })]);
    expect(bubbles().at(-1)).toBe("bot~:It is due on");
    // the reply lands while the stream is still in the summary: one copy of it
    await show([bot("Ada", { status: "talking", streaming: "It is due on the 3rd.", chat: [...echoed, msg("m3", "bot", "It is due on the 3rd.")] })]);
    expect(bubbles()).toEqual(["bot:Paid on Saturday.", "you:check the next one", "bot:It is due on the 3rd."]);
    await unmount();
  });

  it("draws no mascot again while a reply streams into the card", async () => {
    const team = Array.from({ length: 27 }, (_, index) => bot(`B${index}`, { status: index % 3 ? "idle" : "working" }));
    const chat = Array.from({ length: 60 }, (_, index) => msg(`m${index}`, index % 2 ? "bot" : "you", `message ${index}`));
    const snapshot = (streaming: string) => [bot("Ada", { status: "talking", streaming, chat }), ...team.map((entry) => ({ ...entry }))];
    const { show, hover, bubbles, unmount } = await mount(snapshot(""));
    await hover("Ada");
    await wait(DWELL_MS + 60);
    marks.drawn = 0;
    let text = "";
    for (let index = 0; index < 40; index++) { text += ` word${index}`; await show(snapshot(text)); }
    expect(bubbles().at(-1)).toBe(`bot~:${text}`);
    // only the card's own header mark: 28 mascots times 40 summaries before
    expect(marks.drawn).toBeLessThanOrEqual(40);
    await unmount();
  });

  it("is one card from bot to bot: the words swap in place, each chat comes back where it was left, with its history", async () => {
    const long = Array.from({ length: 30 }, (_, index) => msg(`a${index}`, index % 2 ? "bot" : "you", `ada ${index}`));
    const { host, show, hover, card, bubbles, unmount } = await mount([bot("Ada", { chat: long }), bot("Rivet", { chat: [msg("r1", "bot", "Fixed.")] })]);
    await hover("Ada");
    await wait(DWELL_MS + 60);
    const page = card().querySelector(".amb-card-page")!;
    const list = card().querySelector<HTMLElement>(".amb-chat-list")!;
    // happy-dom lays nothing out: a tall chat in a shorter list, as a browser would have it
    let top = 0;
    Object.defineProperties(list, {
      scrollHeight: { get: () => 2000 }, clientHeight: { get: () => 500 },
      scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(1500, value)); } },
    });
    await act(async () => { list.scrollTop = 120; list.dispatchEvent(new Event("scroll")); });
    await hover("Rivet");
    expect(card().querySelector(".amb-card-page")).toBe(page);
    expect(card().querySelector(".amb-chat-list")).toBe(list);
    expect(bubbles()).toEqual(["bot:Fixed."]);
    // the summary now carries only Ada's newest few; the card still has what it saw
    await show([bot("Ada", { chat: long.slice(-6).map((entry) => ({ ...entry, text: entry.text.slice(0, 3) })) }), bot("Rivet", { chat: [msg("r1", "bot", "Fixed.")] })]);
    await hover("Ada");
    expect(bubbles()).toHaveLength(30);
    expect(bubbles().at(-1)).toBe("bot:ada 29");
    expect(list.scrollTop).toBe(120);
    // the chat capped at a share of the screen or CHAT_MAX_H, whichever is smaller, scrolling inside
    expect(card().querySelector<HTMLElement>(".amb-chat")!.style.maxHeight).toBe(`${Math.round(Math.min(CHAT_MAX_H, LAYOUT.height * CHAT_SHARE))}px`);
    expect(host.querySelectorAll(".amb-card")).toHaveLength(1);
    await unmount();
  });

  it("opens nothing when focus comes back to a mascot with the window, only when the keyboard moves it there", async () => {
    const { host, card, unmount } = await mount([bot("Ada"), bot("Rivet")]);
    const mascot = (id: string) => host.querySelector<HTMLButtonElement>(`[data-row="${id}"] .amb-dock-bot`)!;
    // macOS gives the dock the key as the island lets it go, and the page puts focus back on the last mascot
    await act(async () => mascot("Ada").focus());
    await wait(DWELL_MS + 60);
    expect(card().getAttribute("data-card")).toBeNull();
    expect(host.querySelector(".amb-dock")!.hasAttribute("data-hidden")).toBe(true);
    // the person tabs to the next one
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      mascot("Rivet").focus();
    });
    expect(card().getAttribute("data-card")).toBe("Rivet");
    // leaving the window leaves nothing focused to come back to
    await act(async () => { window.dispatchEvent(new Event("blur")); });
    expect(document.activeElement === mascot("Rivet")).toBe(false);
    await unmount();
  });
});

describe("the card's chat, kept", () => {
  it("puts the kept older messages before the summary's newest, keeping each message's longer copy", () => {
    const kept = [msg("a", "you", "one"), msg("b", "bot", "two, in full"), msg("c", "you", "three")];
    expect(keepHistory(kept, [msg("b", "bot", "two"), msg("c", "you", "three"), msg("d", "bot", "four")]).map((entry) => entry.text)).toEqual(["one", "two, in full", "three", "four"]);
    // a summary that already starts further back, or moved past everything kept, is shown as it is
    const fresh = [msg("x", "bot", "new")];
    expect(keepHistory(kept, fresh)).toBe(fresh);
  });

  it("counts the person's messages after the one a message was sent after", () => {
    const chat = [msg("a", "you", "1"), msg("b", "bot", "2"), msg("c", "you", "3"), msg("d", "you", "4")];
    expect(sentSince(chat, "b")).toBe(2);
    expect(sentSince(chat, "d")).toBe(0);
    expect(sentSince(chat, undefined)).toBe(3);
  });
});
