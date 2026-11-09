// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { CARD_LEAVE_MS, DWELL_MS, Dock, HIDE_MS } from "./Dock";
import { SETTLED_MS } from "./shared";
import type { AmbientAct, AmbientBot, AmbientBridge, AmbientSnapshot } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const bot = (id: string, fields: Partial<AmbientBot>): AmbientBot => ({
  id, threadId: `t-${id}`, name: id, color: "blue", body: null, face: null, avatar: null, status: "idle", detail: "", line: "", at: 1, unread: false, asks: 0,
  approval: null, waits: null, question: null, ...fields,
});
const wait = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
const LABELS = { allow: "Allow", deny: "Deny", answer: "Type an answer", send: "Send", sent: "Sent", replyTo: "Reply to {name}", stop: "Stop {name}", dismiss: "Dismiss" };

async function mount(bots: AmbientBot[]) {
  let feed: (snapshot: AmbientSnapshot) => void = () => {};
  const acts: AmbientAct[] = [];
  const seen: string[][] = [];
  const opened: string[] = [];
  let settled = 0;
  const bridge: AmbientBridge = {
    surface: "dock", onState: (cb) => { feed = cb; return () => {}; }, onLayout: () => () => {}, pointer() {}, open: (botId) => opened.push(botId), act: (next) => acts.push(next), order() {}, ready() {},
    onSeen: () => () => {}, seen: (keys) => seen.push(keys), settled: () => { settled += 1; },
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(Dock, { bridge })));
  await act(async () => feed({ lang: "en", labels: LABELS, bots }));
  const cell = (id: string) => host.querySelector<HTMLElement>(`[data-row="${id}"]`)!;
  // as a browser does: the pointer reaches the mascot, then moves (a point inside the dock's edge zone here, where happy-dom
  // lays nothing out)
  const hover = (id: string) => act(async () => {
    cell(id).dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: 360 }));
  });
  return { host, acts, seen, opened, settledCount: () => settled, cell, hover, unmount: () => act(async () => root.unmount()) };
}

afterEach(() => { document.body.innerHTML = ""; });

it("is a column of every bot in the person's order, with a bubble only for news", async () => {
  const { host, cell, unmount } = await mount([
    bot("Moss", {}),
    bot("Nova", { status: "working", detail: "Comparing flights" }),
    bot("Quill", { status: "needs-you", waits: "approval", asks: 2 }),
    bot("Rivet", { status: "done", unread: true, line: "The footer is fixed." }),
    bot("Echo", { status: "error", unread: true, line: "Couldn't reach Gmail." }),
    // what the person is watching in the app: nothing to point at here
    bot("Juno", { status: "done", unread: true, line: "Booked.", quiet: true }),
  ]);
  expect([...host.querySelectorAll("[data-row]")].map((row) => row.getAttribute("data-row"))).toEqual(["Moss", "Nova", "Quill", "Rivet", "Echo", "Juno"]);
  const bubble = (id: string) => cell(id).querySelector(".amb-bubble");
  expect([bubble("Moss"), bubble("Nova"), bubble("Juno")]).toEqual([null, null, null]);
  expect([bubble("Quill")?.getAttribute("data-kind"), bubble("Quill")?.textContent]).toEqual(["ask", "2"]);
  expect(bubble("Rivet")?.getAttribute("data-kind")).toBe("reply");
  expect(bubble("Echo")?.getAttribute("data-kind")).toBe("error");
  // no list of words in the column itself
  expect(host.querySelector(".amb-dock-column .amb-row")).toBeNull();
  await unmount();
});

it("keeps one card for the whole visit: it waits for a rest before the first bot, then moves bot to bot as the same node", async () => {
  const { host, hover, unmount } = await mount(["Nova", "Rivet", "Juno"].map((id) => bot(id, { status: "done", unread: true, line: `${id} replied.` })));
  const card = host.querySelector(".amb-card")!;
  await hover("Nova");
  // landing on a bot as the dock comes out is not choosing it
  expect(card.getAttribute("data-card")).toBeNull();
  await wait(DWELL_MS + 60);
  expect(card.getAttribute("data-card")).toBe("Nova");
  const trail: (string | null)[] = [];
  for (const id of ["Rivet", "Juno", "Nova"]) {
    await hover(id);
    expect(host.querySelector(".amb-card")).toBe(card);
    trail.push(card.getAttribute("data-card"));
  }
  expect(trail).toEqual(["Rivet", "Juno", "Nova"]);
  expect(host.querySelectorAll(".amb-card")).toHaveLength(1);
  await unmount();
});

it("answers an ask in the card and says so, without opening the chat", async () => {
  const { host, acts, hover, unmount } = await mount([
    bot("Juno", { status: "needs-you", waits: "question", asks: 1, question: { requestId: "q1", threadId: "t-Juno", title: "Aisle or window?", choices: ["Aisle", "Window"], custom: true } }),
    bot("Quill", { status: "needs-you", waits: "approval", asks: 1, detail: "Wants to run a command", approval: { requestId: "r1", threadId: "t-Quill", title: "npm test" } }),
  ]);
  await hover("Juno");
  await wait(DWELL_MS + 60);
  const card = host.querySelector(".amb-card")!;
  expect(card.querySelector(".amb-chat-ask-line")?.textContent).toBe("Aisle or window?");
  await act(async () => [...card.querySelectorAll<HTMLButtonElement>(".amb-pill")].find((pill) => pill.textContent === "Window")!.click());
  await hover("Quill");
  await act(async () => [...card.querySelectorAll<HTMLButtonElement>(".amb-pill")].find((pill) => pill.textContent === "Allow")!.click());
  expect(acts).toEqual([
    { kind: "answer", botId: "Juno", threadId: "t-Juno", requestId: "q1", text: "Window" },
    { kind: "allow", botId: "Quill", threadId: "t-Quill", requestId: "r1" },
  ]);
  await hover("Juno");
  expect(card.querySelector(".amb-chat-status")?.textContent).toBe("Sent");
  await unmount();
});

it("shows the hovered bot's recent chat, even an idle one's, and a reply sent there goes to that chat", async () => {
  const { host, acts, hover, unmount } = await mount([
    bot("Ada", { chat: [
      { id: "m1", from: "you", text: "Can you check the invoice from Friday?", at: 1 },
      { id: "m2", from: "bot", text: "Done: it was paid on Saturday, receipt is in your inbox.", at: 2 },
    ] }),
  ]);
  await hover("Ada");
  await wait(DWELL_MS + 60);
  const card = host.querySelector(".amb-card")!;
  const bubbles = [...card.querySelectorAll(".amb-bubble-msg")].map((bubble) => [bubble.getAttribute("data-from"), bubble.textContent]);
  expect(bubbles).toEqual([["you", "Can you check the invoice from Friday?"], ["bot", "Done: it was paid on Saturday, receipt is in your inbox."]]);
  const input = card.querySelector<HTMLInputElement>(".amb-chat-compose .amb-reply-input")!;
  expect(input.getAttribute("aria-label")).toBe("Reply to Ada");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Thanks, file it under taxes");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => card.querySelector<HTMLFormElement>(".amb-chat-compose .amb-reply")!.requestSubmit());
  expect(acts).toEqual([{ kind: "reply", botId: "Ada", threadId: "t-Ada", text: "Thanks, file it under taxes" }]);
  // the field is ready for the next message
  expect(input.value).toBe("");
  await unmount();
});

it("forgives a slip of the pointer: off the bots and straight back, the card stays", async () => {
  const { host, hover, unmount } = await mount([bot("Ada", { chat: [{ id: "m1", from: "bot", text: "Hi", at: 1 }] })]);
  await hover("Ada");
  await wait(DWELL_MS + 60);
  const card = host.querySelector(".amb-card")!;
  await act(async () => host.querySelector(".amb-dock-list")!.dispatchEvent(new PointerEvent("pointerout", { bubbles: true })));
  await wait(CARD_LEAVE_MS / 3);
  await hover("Ada");
  await wait(CARD_LEAVE_MS + 40);
  expect(card.getAttribute("data-card")).toBe("Ada");
  await unmount();
});

it("opens the app only from a bot's mascot: never from the card's words, messages or name", async () => {
  const { host, cell, opened, hover, unmount } = await mount([bot("Ada", { chat: [{ id: "m1", from: "bot", text: "Paid on Saturday.", at: 1 }] })]);
  await hover("Ada");
  await wait(DWELL_MS + 60);
  const card = host.querySelector(".amb-card")!;
  await act(async () => card.querySelector<HTMLElement>(".amb-chat-list")!.click());
  await act(async () => card.querySelector<HTMLElement>(".amb-bubble-msg")!.click());
  await act(async () => card.querySelector<HTMLElement>(".amb-chat-head .amb-row-name")!.click());
  await act(async () => card.querySelector<HTMLElement>(".amb-chat-compose .amb-reply-input")!.click());
  expect(opened).toEqual([]);
  await act(async () => card.querySelector<HTMLButtonElement>(".amb-chat-mascot")!.click());
  await act(async () => cell("Ada").querySelector<HTMLButtonElement>(".amb-dock-bot")!.click());
  expect(opened).toEqual(["Ada", "Ada"]);
  await unmount();
});

it("on the way out the card goes almost at once, and the column only a good while later, then main is told", async () => {
  const { host, settledCount, hover, unmount } = await mount([bot("Ada", { chat: [{ id: "m1", from: "bot", text: "Hi", at: 1 }] })]);
  await hover("Ada");
  await wait(DWELL_MS + 60);
  const card = host.querySelector(".amb-card")!;
  const dock = host.querySelector(".amb-dock")!;
  const before = settledCount();
  await act(async () => host.querySelector(".amb-dock-list")!.dispatchEvent(new PointerEvent("pointerout", { bubbles: true })));
  await act(async () => { document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5000, clientY: 5000 })); });
  await wait(CARD_LEAVE_MS + 40);
  expect(card.getAttribute("data-card")).toBeNull();
  expect(dock.hasAttribute("data-hidden")).toBe(false);
  await wait(HIDE_MS - CARD_LEAVE_MS);
  expect(dock.hasAttribute("data-hidden")).toBe(true);
  expect(settledCount()).toBe(before);
  await wait(SETTLED_MS + 80);
  expect(settledCount()).toBeGreaterThan(before);
  await unmount();
});

it("shows nothing at all with no bots, and every bot once they come", async () => {
  const { host, unmount } = await mount([]);
  expect(host.querySelector(".amb-stage")?.hasAttribute("data-empty")).toBe(true);
  expect(host.querySelectorAll("[data-row]")).toHaveLength(0);
  await unmount();
});

it("while main traces, says when the pointer crosses, the column and the card come and go, and it has settled", async () => {
  let feed: (snapshot: AmbientSnapshot) => void = () => {};
  const events: string[] = [];
  const bridge: AmbientBridge = {
    surface: "dock", onState: (cb) => { feed = cb; return () => {}; }, onLayout: () => () => {}, pointer() {}, open() {}, act() {}, order() {}, ready() {},
    settled() {}, trace: (event) => events.push(event),
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(Dock, { bridge })));
  await act(async () => feed({ lang: "en", labels: {}, bots: [bot("Ada", { chat: [{ id: "m1", from: "bot", text: "Hi", at: 1 }] })] }));
  await act(async () => {
    host.querySelector('[data-row="Ada"]')!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400, clientY: 360 }));
  });
  await wait(DWELL_MS + 60);
  await act(async () => { document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5000, clientY: 5000 })); });
  // in steps, as it happens: React holds a test's updates until each step ends
  await wait(CARD_LEAVE_MS + 40);
  await wait(HIDE_MS - CARD_LEAVE_MS);
  await wait(SETTLED_MS + 80);
  const seen = (name: string) => events.indexOf(name);
  for (const name of ["page-ready", "pointer-enter", "state-column-out", "state-card", "pointer-leave", "state-card-closing", "state-column-closing", "settled-signal"]) expect(seen(name), name).toBeGreaterThanOrEqual(0);
  expect(seen("pointer-leave")).toBeLessThan(seen("state-card-closing"));
  expect(seen("state-card-closing")).toBeLessThan(seen("state-column-closing"));
  expect(seen("state-column-closing")).toBeLessThan(seen("settled-signal"));
  await act(async () => root.unmount());
});
