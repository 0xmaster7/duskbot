// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReconnectBridge, ReconnectView } from "../../electron/workspace-reconnect.mjs";
import { setLocale } from "@/lib/i18n";
import { ReconnectScreen, reconnectText, secondsLeft } from "./ReconnectScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root | null = null;
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
const NOW = 1_800_000_000_000;
const VIEW: ReconnectView = {
  name: "Garage server", attempt: 2, nextAt: NOW + 8_000, checking: false,
  frame: { at: NOW - 60_000, bots: [{ id: "b1", name: "Research", chats: [{ id: "t1", title: "Flights to Goa" }, { id: "t2", title: "" }] }], groups: [{ id: "g1", name: "Launch room" }] },
  places: [{ id: "local", name: "This computer", local: true }, { id: "office", name: "Office" }],
};
function bridgeOf(view: ReconnectView | null) {
  let push: (next: ReconnectView | null) => void = () => {};
  const bridge = { state: vi.fn(async () => view), onState: vi.fn((cb: (next: ReconnectView | null) => void) => { push = cb; return () => {}; }), retry: vi.fn(async () => view), open: vi.fn(async () => {}) } satisfies ReconnectBridge;
  return { bridge, push: (next: ReconnectView | null) => act(async () => push(next)) };
}
beforeEach(() => { setLocale("en"); vi.useFakeTimers({ now: NOW, toFake: ["Date", "setInterval", "clearInterval"] }); host = document.createElement("div"); document.body.append(host); });
afterEach(async () => { await act(async () => root?.unmount()); root = null; host.remove(); vi.useRealTimers(); });

it("says who it waits on and counts down to the next look", () => {
  expect(reconnectText(VIEW, NOW)).toEqual({ title: "reconnecting to Garage server", next: "next try in 8s." });
  expect(secondsLeft(VIEW, NOW + 7_400)).toBe(1);
  expect(secondsLeft(VIEW, NOW + 20_000), "never below zero").toBe(0);
  expect(reconnectText({ ...VIEW, checking: true, nextAt: null }, NOW).next).toBe("looking for it now…");
  expect(reconnectText(null).title).toBe("opening…");
});

it("shows the last-seen chats read only, Try now, and the other workspaces to open", async () => {
  const { bridge, push } = bridgeOf(VIEW);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(ReconnectScreen, { bridge })); });
  await settle();
  expect(host.querySelector("[role='status']")?.textContent).toBe("reconnecting to Garage server");
  expect(host.querySelector("[data-reconnect-next]")?.textContent).toBe("next try in 8s.");
  await act(async () => { vi.advanceTimersByTime(3_000); });
  expect(host.querySelector("[data-reconnect-next]")?.textContent).toBe("next try in 5s.");
  const frame = host.querySelector("[data-reconnect-frame]")!;
  expect(frame.textContent).toContain("Flights to Goa");
  expect(frame.textContent, "an untitled chat still has a name").toContain("new conversation");
  expect(frame.textContent).toContain("Launch room");
  expect(frame.querySelectorAll("button, a, input"), "nothing in the frame does anything").toHaveLength(0);
  host.querySelector<HTMLButtonElement>("[data-reconnect-retry]")!.click();
  await settle();
  expect(bridge.retry).toHaveBeenCalledTimes(1);
  expect([...host.querySelectorAll("[data-reconnect-open]")].map((button) => button.textContent)).toEqual(["this computer", "Office"]);
  host.querySelector<HTMLButtonElement>("[data-reconnect-open='office']")!.click();
  expect(bridge.open).toHaveBeenCalledWith("office");
  await push({ ...VIEW, checking: true, nextAt: null });
  expect(host.querySelector("[data-reconnect-next]")?.textContent).toBe("looking for it now…");
  expect(host.querySelector<HTMLButtonElement>("[data-reconnect-retry]")?.disabled).toBe(true);
});

it("with nothing kept yet there is no list, only the wait", async () => {
  const { bridge } = bridgeOf({ ...VIEW, frame: undefined, places: [] });
  root = createRoot(host);
  await act(async () => { root!.render(createElement(ReconnectScreen, { bridge })); });
  await settle();
  expect(host.querySelector("[data-reconnect-frame]")).toBeNull();
  expect(host.querySelector("[data-reconnect-places]")).toBeNull();
  expect(host.querySelector("[role='status']")?.textContent).toBe("reconnecting to Garage server");
});
