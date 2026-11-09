// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { Island } from "./Island";
import type { AmbientAct, AmbientBot, AmbientBridge, AmbientSnapshot } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const bot = (id: string, fields: Partial<AmbientBot>): AmbientBot => ({
  id, threadId: `t-${id}`, name: id, color: "blue", body: null, face: null, avatar: null, status: "idle", detail: "", line: "", at: 1, unread: false, asks: 0,
  approval: null, waits: null, question: null, ...fields,
});

it("puts the question first with its choices, stops a working bot, and says how many more wait", async () => {
  let feed: (snapshot: AmbientSnapshot) => void = () => {};
  const acts: AmbientAct[] = [];
  const bridge: AmbientBridge = {
    surface: "island", onState: (cb) => { feed = cb; return () => {}; }, onLayout: () => () => {}, pointer() {}, open() {}, act: (next) => acts.push(next), order() {}, ready() {},
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(Island, { bridge })));
  await act(async () => feed({
    lang: "en",
    labels: { island: "Your bots", more: "{count} more waiting", stop: "Stop {name}", replyTo: "Reply to {name}" },
    bots: [
      bot("Echo", { status: "needs-you", waits: "approval", asks: 1, approval: { requestId: "r1", threadId: "t-Echo", title: "npm test" } }),
      bot("Scout", { status: "working" }),
      bot("Nova", { status: "needs-you", waits: "question", asks: 1, question: { requestId: "q1", threadId: "t-Nova", title: "Which branch?", choices: ["main", "dev"] } }),
    ],
  }));
  // the compact island shows a change once it has held for a moment
  await act(async () => new Promise((resolve) => setTimeout(resolve, 650)));
  const rows = [...host.querySelectorAll(".amb-row")];
  expect(rows.map((row) => row.querySelector(".amb-row-name")?.textContent)).toEqual(["Nova", "Echo", "Scout"]);
  expect(host.querySelector(".amb-more")?.textContent).toBe("+1");
  expect(host.querySelector(".amb-island-hit")?.getAttribute("aria-label")).toBe("Your bots, 1 more waiting");
  const choices = [...rows[0]!.querySelectorAll<HTMLButtonElement>(".amb-choices button")];
  expect(choices.map((choice) => choice.textContent)).toEqual(["main", "dev"]);
  await act(async () => choices[1]!.click());
  await act(async () => rows[2]!.querySelector<HTMLButtonElement>('[aria-label="Stop Scout"]')!.click());
  expect(acts).toEqual([
    { kind: "answer", botId: "Nova", threadId: "t-Nova", requestId: "q1", text: "dev" },
    { kind: "stop", botId: "Scout", threadId: "t-Scout" },
  ]);
  expect(rows[1]!.querySelector('[aria-label="Stop Echo"]')).toBeNull();
  await act(async () => root.unmount());
});

it("opens a row into that bot's mini chat in place, with its messages and a reply field, and never the app", async () => {
  let feed: (snapshot: AmbientSnapshot) => void = () => {};
  const acts: AmbientAct[] = [];
  const opened: string[] = [];
  const bridge: AmbientBridge = {
    surface: "island", onState: (cb) => { feed = cb; return () => {}; }, onLayout: () => () => {}, pointer() {}, open: (botId) => opened.push(botId), act: (next) => acts.push(next), order() {}, ready() {},
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(Island, { bridge, forceOpen: true })));
  await act(async () => feed({ lang: "en", labels: { replyTo: "Reply to {name}" }, bots: [
    bot("Nova", { status: "working", detail: "Comparing flights", chat: [{ id: "m1", from: "you", text: "Find me a flight", at: 1 }] }),
  ] }));
  await act(async () => host.querySelector<HTMLButtonElement>(".amb-row-main")!.click());
  expect(opened).toEqual([]);
  // in the chat, the bot's mascot is the way into the app
  await act(async () => host.querySelector<HTMLButtonElement>(".amb-island-chat .amb-chat-mascot")!.click());
  expect(opened).toEqual(["Nova"]);
  expect([...host.querySelectorAll(".amb-island-chat .amb-bubble-msg")].map((bubble) => bubble.textContent)).toEqual(["Find me a flight"]);
  expect(host.querySelector(".amb-island-chat .amb-chat-note")?.textContent).toBe("Comparing flights");
  expect(host.querySelector(".amb-island-chat .amb-reply-input")?.getAttribute("aria-label")).toBe("Reply to Nova");
  // back to every bot; there a row's mascot opens the app too
  await act(async () => host.querySelector<HTMLButtonElement>(".amb-back")!.click());
  expect(host.querySelector(".amb-island-chat")).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>(".amb-row-open")!.click());
  expect(opened).toEqual(["Nova", "Nova"]);
  // the notch is never outlined while it is open: its hit target is gone
  expect(host.querySelector(".amb-island-hit")).toBeNull();
  await act(async () => root.unmount());
});

it("closes in a balanced beat: a pointer in the margin or back within 260 ms keeps it open, then it folds", async () => {
  let feed: (snapshot: AmbientSnapshot) => void = () => {};
  const bridge: AmbientBridge = {
    surface: "island", onState: (cb) => { feed = cb; return () => {}; }, onLayout: () => () => {}, pointer() {}, open() {}, act() {}, order() {}, ready() {},
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(Island, { bridge })));
  await act(async () => feed({ lang: "en", labels: {}, bots: [bot("Nova", { status: "working" })] }));
  const stage = host.querySelector(".amb-stage")!;
  const move = (x: number, y: number) => act(async () => { document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y })); });
  const wait = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
  // the island sits at the top middle of its 560 wide stage; the open panel is 432 wide
  await move(280, 12);
  expect(stage.hasAttribute("data-open")).toBe(true);
  await wait(300);
  // just past the panel's side, inside the margin: still on it
  await move(280 + 432 / 2 + 10, 40);
  await wait(300);
  expect(stage.hasAttribute("data-open")).toBe(true);
  // away, and back in time: nothing happened
  await move(10, 490);
  await wait(80);
  await move(280, 40);
  await wait(300);
  expect(stage.hasAttribute("data-open")).toBe(true);
  // away for good: open a beat, then folded
  await move(10, 490);
  await wait(200);
  expect(stage.hasAttribute("data-open")).toBe(true);
  await wait(120);
  expect(stage.hasAttribute("data-open")).toBe(false);
  await act(async () => root.unmount());
});
it("lists every bot with its state in a word or two, the waiting ones first, and says when they all rest", async () => {
  let feed: (snapshot: AmbientSnapshot) => void = () => {};
  const bridge: AmbientBridge = {
    surface: "island", onState: (cb) => { feed = cb; return () => {}; }, onLayout: () => () => {}, pointer() {}, open() {}, act() {}, order() {}, ready() {},
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(Island, { bridge, forceOpen: true })));
  const labels = { idle: "Idle", working: "Working", "needs-you": "Needs you", error: "Failed", done: "Replied", quiet: "Your bots are resting" };
  await act(async () => feed({ lang: "en", labels, bots: [
    bot("Ada", {}),
    bot("Bolt", { status: "working", detail: "Deploying" }),
    bot("Cinder", { status: "error", unread: true, line: "Build failed." }),
    bot("Atlas", { status: "needs-you", waits: "approval", asks: 1 }),
  ] }));
  const rows = [...host.querySelectorAll(".amb-row")].map((row) => [row.querySelector(".amb-row-name")?.textContent, row.querySelector(".amb-row-state")?.textContent]);
  // a resting bot stays quiet: no state word
  expect(rows).toEqual([["Atlas", "Needs you"], ["Cinder", "Failed"], ["Bolt", "Working"], ["Ada", undefined]]);
  expect(host.querySelector('.amb-count[data-status="idle"]')).toBeNull();
  await act(async () => feed({ lang: "en", labels, bots: [bot("Ada", {}), bot("Bolt", {})] }));
  expect(host.querySelector('.amb-count[data-status="idle"]')?.textContent).toBe("Your bots are resting");
  expect(host.querySelectorAll(".amb-row")).toHaveLength(2);
  await act(async () => root.unmount());
});

it("shows nothing with no bots: no notch face, no panel, no placeholder", async () => {
  let feed: (snapshot: AmbientSnapshot) => void = () => {};
  const bridge: AmbientBridge = {
    surface: "island", onState: (cb) => { feed = cb; return () => {}; }, onLayout: () => () => {}, pointer() {}, open() {}, act() {}, order() {}, ready() {},
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(Island, { bridge, forceOpen: true })));
  await act(async () => feed({ lang: "en", labels: {}, bots: [] }));
  expect(host.querySelector(".amb-stage")?.hasAttribute("data-empty")).toBe(true);
  expect(host.querySelector(".amb-compact-tile")).toBeNull();
  expect(host.querySelector(".amb-row")).toBeNull();
  await act(async () => root.unmount());
});
