// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { Dock } from "./Dock";
import type { AmbientAct, AmbientBot, AmbientBridge, AmbientSnapshot } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const bot = (id: string, fields: Partial<AmbientBot>): AmbientBot => ({
  id, threadId: `t-${id}`, name: id, color: "blue", body: null, face: null, avatar: null, status: "idle", detail: "", line: "", at: 1, unread: false, asks: 0,
  approval: null, waits: null, question: null, ...fields,
});

it("lists every bot in the person's order, says nothing for an idle one, and answers asks in place", async () => {
  let feed: (snapshot: AmbientSnapshot) => void = () => {};
  const acts: AmbientAct[] = [];
  const seen: string[][] = [];
  const bridge: AmbientBridge = {
    surface: "dock", onState: (cb) => { feed = cb; return () => {}; }, onLayout: () => () => {}, pointer() {}, open() {}, act: (next) => acts.push(next), order() {}, ready() {},
    onSeen: () => () => {}, seen: (keys) => seen.push(keys),
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(Dock, { bridge })));
  await act(async () => feed({
    lang: "en",
    labels: { dismiss: "Dismiss", allow: "Allow", deny: "Deny", answer: "Type an answer", send: "Send", sent: "Sent", replyTo: "Reply to {name}", stop: "Stop {name}", "needs-you": "Needs you", working: "Working" },
    bots: [
      bot("Moss", {}),
      bot("Nova", { status: "working", detail: "Comparing flights" }),
      bot("Quill", { status: "needs-you", waits: "approval", asks: 1, detail: "Wants to run a command", approval: { requestId: "r1", threadId: "t-Quill", title: "npm test" } }),
      bot("Juno", { status: "needs-you", waits: "question", asks: 1, question: { requestId: "q1", threadId: "t-Juno", title: "Aisle or window?", choices: ["Aisle", "Window"], custom: true } }),
      bot("Rivet", { status: "done", unread: true, line: "The footer is fixed." }),
    ],
  }));
  const rows = [...host.querySelectorAll<HTMLElement>(".amb-row")];
  expect(rows.map((row) => row.querySelector(".amb-row-name")?.textContent)).toEqual(["Moss", "Nova", "Quill", "Juno", "Rivet"]);
  expect(rows[0]!.querySelector(".amb-row-line")).toBeNull();
  expect(rows[1]!.querySelector(".amb-row-line")?.textContent).toBe("Comparing flights");
  expect(rows[4]!.querySelector(".amb-row-line")?.textContent).toBe("The footer is fixed.");
  // a waiting bot's column says what kind of ask it is; the sliver ticks it
  expect(rows[2]!.querySelector(".amb-ask-glyph")).not.toBeNull();
  expect(rows[2]!.querySelector(".amb-tick")?.getAttribute("data-kind")).toBe("ask");
  expect(rows[0]!.querySelector(".amb-tick")).toBeNull();

  await act(async () => [...rows[2]!.querySelectorAll<HTMLButtonElement>(".amb-pill")].find((pill) => pill.textContent === "Allow")!.click());
  await act(async () => [...rows[3]!.querySelectorAll<HTMLButtonElement>(".amb-pill")].find((pill) => pill.textContent === "Type an answer")!.click());
  const input = rows[3]!.querySelector<HTMLInputElement>(".amb-reply-input")!;
  expect(input.getAttribute("aria-label")).toBe("Type an answer");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Aisle, near the front");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => rows[3]!.querySelector<HTMLFormElement>(".amb-reply")!.requestSubmit());
  await act(async () => rows[1]!.querySelector<HTMLButtonElement>('[aria-label="Stop Nova"]')!.click());
  expect(acts).toEqual([
    { kind: "allow", botId: "Quill", threadId: "t-Quill", requestId: "r1" },
    { kind: "answer", botId: "Juno", threadId: "t-Juno", requestId: "q1", text: "Aisle, near the front" },
    { kind: "stop", botId: "Nova", threadId: "t-Nova" },
  ]);
  // a fresh reply can be put away without opening it; then it stays only as a muted line
  await act(async () => rows[4]!.querySelector<HTMLButtonElement>('[aria-label="Dismiss: Rivet"]')!.click());
  expect(seen).toEqual([["Rivet:done:1"]]);
  expect(rows[4]!.querySelector(".amb-row-line")?.getAttribute("data-kind")).toBe("recent");
  expect(rows[4]!.querySelector(".amb-tick")).toBeNull();
  // answered here: the row says so until the summary moves on
  expect(rows[2]!.querySelector(".amb-row-line")?.textContent).toBe("Sent");
  expect(rows[2]!.querySelector(".amb-ask-glyph")).toBeNull();
  await act(async () => root.unmount());
});

it("keeps one highlight for the whole hover session: the same node glides from bot to bot, never hidden between", async () => {
  let feed: (snapshot: AmbientSnapshot) => void = () => {};
  const bridge: AmbientBridge = {
    surface: "dock", onState: (cb) => { feed = cb; return () => {}; }, onLayout: () => () => {}, pointer() {}, open() {}, act() {}, order() {}, ready() {},
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(Dock, { bridge })));
  await act(async () => feed({ lang: "en", labels: {}, bots: ["Nova", "Rivet", "Juno"].map((id) => bot(id, { status: "done", unread: true, line: `${id} replied` })) }));
  // open it (keyboard focus on a mascot does), then move the pointer: a move is what chooses a row
  await act(async () => host.querySelector<HTMLButtonElement>(".amb-dock-bot")!.focus());
  await act(async () => {
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 120 }));
  });
  const band = host.querySelector(".amb-band")!;
  const cells = [...host.querySelectorAll<HTMLElement>("[data-row]")];
  const trail: (string | null)[] = [];
  for (const cell of [cells[0]!, cells[1]!, cells[2]!, cells[0]!]) {
    await act(async () => cell.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    expect(host.querySelector(".amb-band")).toBe(band);
    trail.push(band.getAttribute("data-on"));
  }
  expect(trail).toEqual(["Nova", "Rivet", "Juno", "Nova"]);
  expect(host.querySelectorAll(".amb-band")).toHaveLength(1);
  await act(async () => root.unmount());
});
