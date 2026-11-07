// @vitest-environment happy-dom
// The live desktop's own lifecycle, with the connection played by the test.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Events = { connected(): void; disconnected(): void; clipboard?(text: string): void };
const fixture = vi.hoisted(() => ({
  attempts: [] as Array<{ target: string; events: Events; screen: HTMLElement; client: { focus: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; viewOnly: boolean; focusOnClick: boolean } }>,
  refuse: false,
  typed: [] as string[],
  pasted: [] as string[],
}));
vi.mock("@/lib/desktop-connection", async (importOriginal) => ({
  isPasteShortcut: (await importOriginal<typeof import("@/lib/desktop-connection")>()).isPasteShortcut,
  connectDesktop: async (screen: HTMLElement, target: string, options: { events: Events }) => {
    if (fixture.refuse) throw new Error("unreachable");
    // noVNC's canvas: the desktop's own size, focusable, and the guest's cursor painted on it
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 800;
    canvas.tabIndex = -1;
    canvas.style.cursor = "none";
    screen.append(canvas);
    const client = { focus: vi.fn(() => canvas.focus()), disconnect: vi.fn(), viewOnly: false, focusOnClick: true };
    fixture.attempts.push({ target, events: options.events, client, screen });
    return client;
  },
  typeOnDesktop: (_client: unknown, text: string) => fixture.typed.push(text),
  pasteOnDesktop: (_client: unknown, text: string) => fixture.pasted.push(text),
}));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useCaptionChrome: () => ({ padClass: undefined, dragProps: {}, noDragStyle: undefined }),
  useDesktopCapabilities: () => ({ ready: true, capabilities: { windowChrome: "native" } }),
}));

const { LiveDesktop } = await import("./LiveDesktop");
const css = readFileSync("src/styles.css", "utf8");
const noDragSelector = /\/\* Window drag regions\.[\s\S]*?\*\/\s*([^{]+)\{\s*-webkit-app-region: no-drag;/.exec(css)![1].trim();
let root: Root;
let props: Parameters<typeof LiveDesktop>[0];
const draw = (patch: Partial<typeof props> = {}) => {
  props = { ...props, ...patch };
  flushSync(() => root.render(createElement(LiveDesktop, props)));
};
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const state = () => document.querySelector<HTMLElement>("[data-live-desktop]")?.dataset.state;
const button = (label: string) => [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label);

beforeEach(async () => {
  fixture.attempts = [];
  fixture.refuse = false;
  fixture.typed = [];
  fixture.pasted = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    target: "local/shared", threadId: "thread", name: "Scout", poster: null, expanded: false,
    onExpandedChange: vi.fn(), onHandBack: vi.fn(), handingBack: false, onUnreachable: vi.fn(),
  };
  draw();
  await settle();
});
afterEach(() => {
  root.unmount();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("the live desktop", () => {
  it("takes the keyboard once the desktop answers", () => {
    expect(state()).toBe("connecting");
    flushSync(() => fixture.attempts[0]!.events.connected());
    expect(state()).toBe("connected");
    expect(fixture.attempts[0]!.client.focus).toHaveBeenCalled();
  });

  it("a desktop that never answers is reported, so the computer goes back to the bot", () => {
    flushSync(() => fixture.attempts[0]!.events.disconnected());
    expect(props.onUnreachable).toHaveBeenCalledTimes(1);
  });

  it("a connection the server refuses is reported the same way", async () => {
    root.unmount();
    fixture.refuse = true;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    draw({ onUnreachable: vi.fn() });
    await settle();
    expect(props.onUnreachable).toHaveBeenCalledTimes(1);
  });

  it("a drop mid-session reconnects once and reports an exhausted recovery", async () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    flushSync(() => fixture.attempts[0]!.events.connected());
    flushSync(() => fixture.attempts[0]!.events.disconnected());
    expect(state()).toBe("disconnected");
    expect(props.onUnreachable).not.toHaveBeenCalled();
    await wait(1_200);
    expect(fixture.attempts).toHaveLength(2);
    expect(fixture.attempts[0]!.client.disconnect).toHaveBeenCalled();
    flushSync(() => fixture.attempts[1]!.events.disconnected());
    await wait(1_500);
    expect(fixture.attempts, "no endless reconnect loop").toHaveLength(2);
    expect(props.onUnreachable).toHaveBeenCalledTimes(1);
    flushSync(() => button("Reconnect")!.click());
    await settle();
    expect(fixture.attempts).toHaveLength(3);
  });

  it("watching, taking control and handing back reuse one connection without granting input while watching", async () => {
    draw({ viewOnly: true });
    await settle();
    const client = fixture.attempts[0]!.client;
    flushSync(() => fixture.attempts[0]!.events.connected());
    expect(client.viewOnly).toBe(true);
    expect(client.focusOnClick).toBe(false);
    expect(client.focus).not.toHaveBeenCalled();
    draw({ viewOnly: false });
    expect(client.viewOnly).toBe(false);
    expect(client.focusOnClick).toBe(true);
    expect(client.focus).toHaveBeenCalled();
    draw({ viewOnly: true });
    expect(client.viewOnly).toBe(true);
    expect(client.focusOnClick).toBe(false);
    expect(fixture.attempts).toHaveLength(1);
  });

  it("ignores a previous desktop's late events and reports a new desktop that never answered", async () => {
    const first = fixture.attempts[0]!;
    flushSync(() => first.events.connected());
    draw({ target: "vps/second", threadId: "second-thread" });
    await settle();
    expect(state()).toBe("connecting");
    flushSync(() => first.events.disconnected());
    flushSync(() => first.events.connected());
    expect(state()).toBe("connecting");
    expect(props.onUnreachable).not.toHaveBeenCalled();
    flushSync(() => fixture.attempts[1]!.events.disconnected());
    expect(props.onUnreachable).toHaveBeenCalledTimes(1);
  });

  it("closes its connection when it goes away", () => {
    const client = fixture.attempts[0]!.client;
    root.unmount();
    expect(client.disconnect).toHaveBeenCalled();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  it("opens the original viewer read-only and enables input only through its control button", () => {
    const open = vi.fn();
    const take = vi.fn();
    draw({ originalViewer: true, viewOnly: true, onOpenPreview: open, onTakeControl: take });
    flushSync(() => fixture.attempts[0]!.events.connected());
    flushSync(() => button("Open")!.click());
    expect(open).toHaveBeenCalledTimes(1);
    expect(take).not.toHaveBeenCalled();
    draw({ expanded: true });
    expect(document.querySelector("[data-computer-control=watching]")).not.toBeNull();
    expect(fixture.attempts[0]!.client.viewOnly).toBe(true);
    expect(button("Keyboard")).toBeUndefined();
    expect(document.querySelector("header")).toBeNull();
    flushSync(() => button("Take control")!.click());
    expect(take).toHaveBeenCalledTimes(1);
    draw({ viewOnly: false });
    expect(fixture.attempts[0]!.client.viewOnly).toBe(false);
    expect(document.querySelector("[data-computer-control=held]")).not.toBeNull();
    expect(fixture.attempts).toHaveLength(1);
    draw({ viewOnly: true });
    expect(fixture.attempts[0]!.client.viewOnly).toBe(true);
    expect(document.querySelector("[data-computer-control=watching]")).not.toBeNull();
  });

  it("full screen keeps the same connection and offers Exit, typing and Hand back", async () => {
    flushSync(() => fixture.attempts[0]!.events.connected());
    draw({ expanded: true });
    await settle();
    expect(fixture.attempts, "growing the view must not reconnect").toHaveLength(1);
    const field = document.querySelector<HTMLInputElement>("input[aria-label='Text to type on the desktop']")!;
    flushSync(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(field, "hunter2");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    flushSync(() => field.form!.requestSubmit());
    expect(fixture.typed).toEqual(["hunter2"]);
    flushSync(() => button("Exit fullscreen")!.click());
    expect(props.onExpandedChange).toHaveBeenCalledWith(false);
    flushSync(() => button("Hand control back")!.click());
    expect(props.onHandBack).toHaveBeenCalledTimes(1);
  });

  // On macOS and frameless Windows the sidebar, chat header and frame bar under the full-screen desktop are window
  // drag regions, and Electron ignores z-index for them, so a press on the top of the live screen moved the window.
  it("full screen opts the live screen out of the window drag regions beneath it", () => {
    const desktop = () => document.querySelector<HTMLElement>("[data-live-desktop]")!;
    expect(desktop().matches(noDragSelector), "in the side panel nothing changes").toBe(false);
    draw({ expanded: true });
    expect(desktop().matches(noDragSelector)).toBe(true);
    draw({ expanded: false });
    expect(desktop().matches(noDragSelector)).toBe(false);
  });

  it("shows the bot waking up until the first frame, never a connecting line, and reports the screen's shape", async () => {
    const sizes: Array<[number, number]> = [];
    root.unmount();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    draw({ originalViewer: true, viewOnly: true, waking: (expanded) => createElement("div", { "data-test-waking": String(expanded) }, "Scout is waking up"), onScreenSize: (width, height) => sizes.push([width, height]) });
    await settle();
    const attempt = fixture.attempts.at(-1)!;
    expect(document.querySelector("[data-test-waking]")?.getAttribute("data-test-waking")).toBe("false");
    expect(document.body.textContent).not.toMatch(/connecting/i);
    flushSync(() => attempt.events.connected());
    expect(document.querySelector("[data-test-waking]")).toBeNull();
    expect(sizes).toEqual([[1280, 800]]);
    draw({ expanded: true });
    expect(document.querySelector<HTMLElement>("[data-computer-frame]")!.style.aspectRatio).toMatch(/^1\.6\b/);
  });

  it("marks the screen while watching so the person's pointer takes its own watching or control shape over it", () => {
    const screen = () => document.querySelector<HTMLElement>("[data-live-desktop-screen]")!;
    draw({ viewOnly: true });
    expect(screen().hasAttribute("data-watching")).toBe(true);
    draw({ viewOnly: false });
    expect(screen().hasAttribute("data-watching")).toBe(false);
    const rule = readFileSync("src/components/computer-fullscreen.css", "utf8");
    expect(rule).toContain("[data-live-desktop-screen][data-watching] canvas");
    expect(rule).toContain("[data-live-desktop-screen]:not([data-watching]) canvas");
    // both are custom ring cursors centred on their hotspot, with a plain fallback
    expect(rule.match(/url\("data:image\/svg\+xml,[^"]*"\) 10 10, (default|crosshair) !important/g)).toHaveLength(2);
  });

  it("pastes the person's clipboard into the desktop in control, and never while watching", () => {
    const paste = (text: string) => {
      const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => type === "text/plain" ? text : "" } });
      document.activeElement!.dispatchEvent(event);
      return event;
    };
    draw({ viewOnly: true });
    flushSync(() => fixture.attempts[0]!.events.connected());
    const canvas = fixture.attempts[0]!.screen.querySelector("canvas")!;
    canvas.focus();
    expect(paste("watching").defaultPrevented).toBe(false);
    expect(fixture.pasted).toEqual([]);
    draw({ viewOnly: false });
    expect(document.activeElement).toBe(canvas);
    const reachedGuest = vi.fn();
    canvas.addEventListener("keydown", reachedGuest);
    const shortcut = new KeyboardEvent("keydown", { key: "v", code: "KeyV", metaKey: navigator.userAgent.includes("Mac"), ctrlKey: !navigator.userAgent.includes("Mac"), bubbles: true, cancelable: true });
    canvas.dispatchEvent(shortcut);
    expect(reachedGuest, "the shortcut itself never reaches the guest").not.toHaveBeenCalled();
    expect(shortcut.defaultPrevented, "the browser's own paste still follows").toBe(false);
    expect(paste("pasted from the mac").defaultPrevented).toBe(true);
    expect(fixture.pasted).toEqual(["pasted from the mac"]);
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", bubbles: true }));
    expect(reachedGuest).toHaveBeenCalledTimes(1);
  });

  it("in control, what the person copies on the desktop reaches their own clipboard", () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText, readText: vi.fn() } });
    try {
      draw({ viewOnly: true });
      flushSync(() => fixture.attempts[0]!.events.connected());
      fixture.attempts[0]!.events.clipboard?.("seen while watching");
      draw({ viewOnly: false });
      fixture.attempts[0]!.events.clipboard?.("copied on the desktop");
      expect(writeText.mock.calls).toEqual([["copied on the desktop"]]);
    } finally {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });
});
