// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HomeBridge, HomeView, LastSeen } from "../../electron/home-window.mjs";
import { setLocale } from "@/lib/i18n";
import { HomeScreen } from "./HomeScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root | null = null;
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
const seen: LastSeen = { savedAt: 1, bots: [
  { id: "scout", threadId: "t-scout", name: "Scout", messages: [{ id: "m1", role: "user", text: "find flights to Goa", at: 1 }, { id: "m2", role: "bot", text: "Three options under ₹9,000.", at: 2 }] },
  { id: "quill", threadId: "t-quill", name: "Quill", messages: [{ id: "m3", role: "bot", text: "Draft is ready.", at: 3 }] },
] };
function bridgeOf(view: HomeView, lastSeen: LastSeen | null = seen) {
  let listener: ((view: HomeView) => void) | null = null;
  const bridge = {
    state: vi.fn(async () => view), onState: vi.fn((cb: (view: HomeView) => void) => { listener = cb; return () => {}; }), retry: vi.fn(async () => view),
    signIn: vi.fn(async () => {}), repair: vi.fn(async () => {}), lastSeen: vi.fn(async () => lastSeen),
    wake: vi.fn(async (_intent: "type" | "click" | "send", send?: unknown) => ({ screen: "asleep", waking: true, ...(send ? { held: (send as { text: string }).text } : {}) }) as HomeView),
  } satisfies HomeBridge;
  return { bridge, push: (next: HomeView) => act(async () => { listener?.(next); }) };
}
async function mount(bridge: HomeBridge) {
  root = createRoot(host);
  await act(async () => { root!.render(createElement(HomeScreen, { bridge })); });
  await settle();
}
const composer = () => host.querySelector<HTMLTextAreaElement>("[data-cloud-asleep-composer]")!;
const line = () => host.querySelector("[data-cloud-asleep-line]")?.textContent;
const key = (key: string, init: KeyboardEventInit = {}) => act(async () => { composer().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
const type = (value: string) => act(async () => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(composer(), value);
  composer().dispatchEvent(new Event("input", { bubbles: true }));
});
beforeEach(() => { setLocale("en"); host = document.createElement("div"); document.body.append(host); Object.assign(window, { duskDesktop: {} }); });
afterEach(async () => { await act(async () => root?.unmount()); root = null; host.remove(); });

it("shows the last-seen chats read-only with the quiet line, and opening or reading never wakes it", async () => {
  const { bridge } = bridgeOf({ screen: "asleep" });
  await mount(bridge);
  expect(host.querySelector("[data-home-screen]")?.getAttribute("data-home-screen")).toBe("asleep");
  expect(line()).toBe("asleep · wakes when you type");
  expect([...host.querySelectorAll("ol li div")].map((node) => node.textContent)).toEqual(["find flights to Goa", "Three options under ₹9,000."]);
  await act(async () => { host.querySelector<HTMLButtonElement>("nav button:nth-child(2)")!.click(); });
  expect(host.querySelector("ol li div")?.textContent).toBe("Draft is ready.");
  expect(host.querySelector("nav button[aria-current='page']")?.textContent).toBe("Quill");
  await key("Tab");
  await key("c", { metaKey: true });
  expect(bridge.wake, "moving around or copying is no intent").not.toHaveBeenCalled();
  expect(composer().getAttribute("aria-label")).toBe("message Quill");
});

it("the first key press wakes it once, with a clear waking line; the typed text stays and Enter holds it to send once awake", async () => {
  const { bridge, push } = bridgeOf({ screen: "asleep" });
  await mount(bridge);
  await key("h");
  await type("hi there");
  await key("i");
  expect(bridge.wake).toHaveBeenCalledTimes(1);
  expect(bridge.wake).toHaveBeenCalledWith("type", null);
  expect(line()).toBe("waking up…");
  expect(composer().value).toBe("hi there");
  await key("Enter");
  expect(bridge.wake).toHaveBeenCalledTimes(2);
  const [intent, send] = bridge.wake.mock.calls[1]!;
  expect(intent).toBe("send");
  expect(send).toMatchObject({ botId: "scout", threadId: "t-scout", text: "hi there" });
  expect((send as { sendId: string }).sendId).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
  await push({ screen: "asleep", waking: true, held: "hi there" });
  expect(host.querySelector("[data-cloud-asleep-held]")?.textContent).toBe("hi theresends when it's awake");
  expect(composer().value).toBe("");
});

it("a click in the composer wakes it; with nothing seen yet, Wake it now is the one action", async () => {
  const { bridge } = bridgeOf({ screen: "asleep" });
  await mount(bridge);
  await act(async () => { composer().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
  expect(bridge.wake).toHaveBeenCalledWith("click", null);
  await act(async () => root?.unmount());
  const empty = bridgeOf({ screen: "asleep" }, null);
  await mount(empty.bridge);
  expect(host.textContent).toContain("no chats seen on this computer yet.");
  const button = [...host.querySelectorAll("button")].find((node) => node.textContent === "wake it now")!;
  await act(async () => { button.click(); });
  expect(empty.bridge.wake).toHaveBeenCalledWith("click", null);
});
