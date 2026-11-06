// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MausAvatar, type MausAvatarHandle, type MausAvatarProps } from "./Avatar";
import { mascotClock } from "./mascot-clock";
import { IDLE_SETTLE_MS } from "./mascot-motion-mark";
import { UNREAD_NOTICE_MS, useUnreadNotice } from "./unread-notice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const observed: { callback: ((entries: Array<{ target: Element; isIntersecting: boolean }>) => void) | null } = { callback: null };
class FakeIntersectionObserver {
  constructor(callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void) {
    observed.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

let reducedMotion = false;
const motionListeners = new Set<() => void>();
vi.stubGlobal("matchMedia", (query: string) => ({
  get matches() { return query.includes("reduce") && reducedMotion; },
  addEventListener: (_: string, listener: () => void) => motionListeners.add(listener),
  removeEventListener: (_: string, listener: () => void) => motionListeners.delete(listener),
}));

let frameRequests = 0;
let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    frameRequests++;
    return raf(callback);
  };
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  frameRequests = 0;
  reducedMotion = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (avatars: Array<Partial<MausAvatarProps> & { ref?: React.Ref<MausAvatarHandle> }>) =>
  act(() => root.render(avatars.map((props, key) => createElement(MausAvatar, { key, color: "green", ...props }))));
const run = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const markOf = () => host.querySelector(".grok-bot-mark")!;

describe("grok marks on the shared clock", () => {
  it("draws every busy mascot from one animation frame, 60 times a second", () => {
    render(Array.from({ length: 12 }, (_, i) => ({ state: "working" as const, size: [24, 28, 36, 64][i % 4] })));
    run(100);
    frameRequests = 0;
    run(1000);
    expect(frameRequests).toBeGreaterThanOrEqual(55);
    expect(frameRequests).toBeLessThanOrEqual(70);
    expect(mascotClock().pending()).toBe(12);
  });

  it("paints a static mascot once, in grok's idle rest pose, and then asks for nothing", () => {
    render([{ state: "sleeping", animated: false, size: 24 }]);
    run(100);
    expect(markOf().getAttribute("data-grok-state")).toBe("idle");
    expect(host.querySelector("svg path")).not.toBeNull();
    frameRequests = 0;
    run(2000);
    expect(frameRequests).toBe(0);
    expect(mascotClock().pending()).toBe(0);
  });

  it("draws a static header mark the same whether the bot is busy or not", () => {
    const markup = (state: MausAvatarProps["state"]) => renderToStaticMarkup(createElement(MausAvatar, { color: "green", state, size: 24, animated: false }));
    expect(markup("working")).toBe(markup("idle"));
  });

  it("lets an idle mascot with grok's still idle settle to no frames, and wakes it for a blink", () => {
    const ref = createRef<MausAvatarHandle>();
    render([{ state: "idle", size: 24, ref, personality: false }]);
    run(1000);
    expect(mascotClock().pending()).toBe(0);
    frameRequests = 0;
    run(2000);
    expect(frameRequests).toBe(0);
    act(() => ref.current!.blink());
    run(500);
    expect(frameRequests).toBeGreaterThan(5);
    expect(mascotClock().pending()).toBe(0);
  });

  it("keeps playing 1.4 s after a turn ends, then rests and sleeps", () => {
    render([{ state: "working", size: 28, personality: false }]);
    run(1000);
    render([{ state: "idle", size: 28, personality: false }]);
    run(IDLE_SETTLE_MS - 200);
    expect(mascotClock().pending()).toBe(1);
    run(1500);
    expect(mascotClock().pending()).toBe(0);
  });

  it("lets an unread mascot play its notice, then draws nothing while the news waits", () => {
    function Row({ unread }: { unread: boolean }) {
      return createElement(MausAvatar, { color: "green", state: unread ? "notifying" : "idle", size: 42, animated: useUnreadNotice(unread) });
    }
    act(() => root.render(createElement(Row, { unread: false })));
    run(200);
    act(() => root.render(createElement(Row, { unread: true })));
    frameRequests = 0;
    run(2000);
    expect(frameRequests).toBeGreaterThan(20);
    run(UNREAD_NOTICE_MS);
    run(1000);
    frameRequests = 0;
    run(30_000);
    expect(frameRequests).toBe(0);
    expect(mascotClock().pending()).toBe(0);
  });

  it("stops drawing a mascot that leaves the screen", () => {
    render([{ state: "working", size: 36 }]);
    run(200);
    act(() => observed.callback!([{ target: markOf(), isIntersecting: false }]));
    frameRequests = 0;
    run(1000);
    expect(frameRequests).toBe(0);
    act(() => observed.callback!([{ target: markOf(), isIntersecting: true }]));
    run(500);
    expect(frameRequests).toBeGreaterThan(5);
  });

  it("holds still under reduced motion: no clip, blink or spin", () => {
    reducedMotion = true;
    const ref = createRef<MausAvatarHandle>();
    render([{ state: "celebrate", size: 64, ref }]);
    run(200);
    frameRequests = 0;
    act(() => { ref.current!.blink(); ref.current!.spin(); });
    run(2000);
    expect(frameRequests).toBe(0);
    expect(mascotClock().pending()).toBe(0);
  });

  it("calms an animating mascot when reduced motion is switched on", () => {
    render([{ state: "working", size: 36 }]);
    run(200);
    expect(mascotClock().pending()).toBe(1);
    reducedMotion = true;
    act(() => { for (const listener of motionListeners) listener(); });
    run(200);
    expect(mascotClock().pending()).toBe(0);
  });
});
