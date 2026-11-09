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
