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

it("puts the asking bots first, answers each ask below the mascots for that bot only, and says how many more wait", async () => {
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
    labels: { island: "Your bots", more: "{count} more waiting", allow: "Allow", deny: "Deny" },
    bots: [
      bot("Echo", { status: "needs-you", waits: "approval", asks: 1, detail: "Wants to run a command", approval: { requestId: "r1", threadId: "t-Echo", title: "npm test" } }),
      bot("Scout", { status: "working" }),
      bot("Nova", { status: "needs-you", waits: "question", asks: 1, question: { requestId: "q1", threadId: "t-Nova", title: "Which branch?", choices: ["main", "dev"] } }),
    ],
  }));
  // the compact island shows a change once it has held for a moment
  await act(async () => new Promise((resolve) => setTimeout(resolve, 650)));
  expect([...host.querySelectorAll(".amb-strip [data-row]")].map((cell) => cell.getAttribute("data-row"))).toEqual(["Nova", "Echo", "Scout"]);
  expect(host.querySelector(".amb-more")?.textContent).toBe("+1");
  expect(host.querySelector(".amb-island-hit")?.getAttribute("aria-label")).toBe("Your bots, 1 more waiting");
  // one ask per bot that waits, none for the one at work
  const asks = [...host.querySelectorAll<HTMLElement>(".amb-ask")];
  expect(asks.map((ask) => ask.getAttribute("data-ask"))).toEqual(["Nova", "Echo"]);
  expect(asks[0]!.querySelector(".amb-ask-line")?.textContent).toBe("NovaWhich branch?");
  await act(async () => [...asks[0]!.querySelectorAll<HTMLButtonElement>(".amb-choices button")].find((choice) => choice.textContent === "dev")!.click());
  await act(async () => [...asks[1]!.querySelectorAll<HTMLButtonElement>(".amb-choices button")].find((choice) => choice.textContent === "Allow")!.click());
  expect(acts).toEqual([
    { kind: "answer", botId: "Nova", threadId: "t-Nova", requestId: "q1", text: "dev" },
    { kind: "allow", botId: "Echo", threadId: "t-Echo", requestId: "r1" },
  ]);
  expect(host.querySelector('.amb-ask[data-ask="Scout"]')).toBeNull();
  await act(async () => root.unmount());
});

it("opens into a grid of mascots with their names, the newest line in a tip just under the one pointed at, and a click opens that bot", async () => {
  let feed: (snapshot: AmbientSnapshot) => void = () => {};
  const opened: string[] = [];
  const bridge: AmbientBridge = {
    surface: "island", onState: (cb) => { feed = cb; return () => {}; }, onLayout: () => () => {}, pointer() {}, open: (botId) => opened.push(botId), act() {}, order() {}, ready() {},
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(Island, { bridge, forceOpen: true })));
  const team = Array.from({ length: 14 }, (_, index) => bot(`Bot${index}`, { line: `said ${index}`, at: Date.now() - 3_600_000, chat: [{ id: "m1", from: "bot", text: "hello", at: 1 }] }));
  await act(async () => feed({ lang: "en", labels: { open: "Open {name}" }, bots: team }));
  const strip = host.querySelector(".amb-strip")!;
  // every bot in the one grid, however many (it wraps onto more rows: ambient-css.test.ts)
  expect(strip.querySelectorAll(".amb-strip-bot")).toHaveLength(14);
  expect(host.querySelectorAll(".amb-strip")).toHaveLength(1);
  // each cell: the mascot and its name, the line only on hover, no chat
  expect(strip.querySelector('[data-row="Bot3"] .amb-strip-name')?.textContent).toBe("Bot3");
  expect(host.querySelector(".amb-panel")!.textContent).not.toContain("said");
  expect(host.querySelector(".amb-row, .amb-chat")).toBeNull();
  const mascot = strip.querySelector<HTMLButtonElement>('[data-row="Bot3"] .amb-strip-bot')!;
  expect(mascot.getAttribute("aria-label")).toBe("Open Bot3. 1h");
  // happy-dom lays nothing out: the mascot on the second row of a grid scrolled down a little
  Object.defineProperties(mascot, { offsetLeft: { get: () => 150 }, offsetTop: { get: () => 52 }, offsetWidth: { get: () => 44 }, offsetHeight: { get: () => 44 } });
  Object.defineProperties(strip, { scrollTop: { get: () => 10 }, clientWidth: { get: () => 400 }, offsetLeft: { get: () => 10 } });
  await act(async () => mascot.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
  const tip = host.querySelector<HTMLElement>(".amb-tip");
  expect(tip?.textContent).toBe("said 3");
  expect([tip?.style.left, tip?.style.top]).toEqual(["172px", "88px"]);
  await act(async () => mascot.dispatchEvent(new PointerEvent("pointerout", { bubbles: true })));
  expect(host.querySelector(".amb-tip")).toBeNull();
  await act(async () => mascot.click());
  expect(opened).toEqual(["Bot3"]);
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
it("marks each mascot's state as the dock does: blue working, green unseen reply, a numbered bubble for asks", async () => {
  let feed: (snapshot: AmbientSnapshot) => void = () => {};
  const bridge: AmbientBridge = {
    surface: "island", onState: (cb) => { feed = cb; return () => {}; }, onLayout: () => () => {}, pointer() {}, open() {}, act() {}, order() {}, ready() {},
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(Island, { bridge, forceOpen: true })));
  const minutes = (count: number) => Date.now() - count * 60_000;
  await act(async () => feed({ lang: "en", labels: { working: "Working", "needs-you": "Needs you", done: "Replied", error: "Failed", now: "now", open: "Open {name}" }, bots: [
    bot("Ada", { at: minutes(120) }),
    bot("Bolt", { status: "working", detail: "Deploying" }),
    bot("Rivet", { status: "done", unread: true, line: "Fixed.", at: minutes(5) }),
    bot("Cinder", { status: "error", unread: true, line: "Build failed." }),
    bot("Atlas", { status: "needs-you", waits: "approval", asks: 2 }),
  ] }));
  const cells = [...host.querySelectorAll(".amb-strip [data-row]")];
  const marks = cells.map((cell) => [cell.getAttribute("data-row"), cell.querySelector(".amb-state-dot")?.getAttribute("data-state") ?? null, cell.querySelector(".amb-bubble")?.textContent ?? null]);
  expect(marks).toEqual([["Atlas", null, "2"], ["Cinder", null, "!"], ["Bolt", "working", null], ["Rivet", "done", null], ["Ada", null, null]]);
  // under each mascot its name and its state in a quiet word or two; resting, only when it was last active
  expect(cells.map((cell) => cell.querySelector(".amb-strip-state")?.textContent)).toEqual(["Needs you", "Failed", "Working", "Replied 5m", "2h"]);
  // the state is in each mascot's name for a screen reader, not only its colour
  expect(cells[2]!.querySelector("button")?.getAttribute("aria-label")).toBe("Open Bolt. Working");
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
  expect(host.querySelector(".amb-strip-bot")).toBeNull();
  await act(async () => root.unmount());
});
