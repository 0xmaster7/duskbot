import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No DOM here: state is held by call order, layout effects run after each render when their deps change, and a state
// change renders again.
const react = vi.hoisted(() => {
  const slots: unknown[] = [];
  const effects: Array<{ deps: unknown[]; cleanup: void | (() => void) }> = [];
  let queued: Array<() => void> = [];
  let cursor = 0;
  let effectCursor = 0;
  let changed = false;
  return {
    reset() {
      for (const effect of effects) if (typeof effect.cleanup === "function") effect.cleanup();
      slots.length = 0;
      effects.length = 0;
    },
    render<T>(hook: () => T): T {
      let result: T;
      let passes = 0;
      do {
        if (++passes > 10) throw new Error("hook never settled");
        changed = false;
        cursor = 0;
        effectCursor = 0;
        queued = [];
        result = hook();
        for (const run of queued) run();
      } while (changed);
      return result;
    },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next: unknown) => {
        const value = typeof next === "function" ? (next as (current: unknown) => unknown)(slots[index]) : next;
        if (Object.is(value, slots[index])) return;
        slots[index] = value;
        changed = true;
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useLayoutEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = effectCursor++;
      const previous = effects[index];
      if (previous && deps.every((dep, at) => Object.is(dep, previous.deps[at]))) return;
      queued.push(() => {
        if (typeof previous?.cleanup === "function") previous.cleanup();
        effects[index] = { deps, cleanup: effect() };
      });
    },
    get changed() { return changed; },
  };
});
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: react.useState,
  useRef: react.useRef,
  useLayoutEffect: react.useLayoutEffect,
}));

const { useHeldMenuMotion, useMenuMotion } = await import("./MenuMotion");

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  react.reset();
  vi.useRealTimers();
});

describe("menu motion", () => {
  it("shows a menu on the render it opens, raw, with no pop", () => {
    expect(react.render(() => useMenuMotion(false))).toMatchObject({ shown: false, closing: false });
    const open = react.render(() => useMenuMotion(true));
    expect(open).toMatchObject({ shown: true, closing: false, className: "raw-popup", exitProps: {} });
    expect(open.className).not.toMatch(/animate-/);
  });

  it("drops a menu on the render it closes, as grok's do", () => {
    react.render(() => useMenuMotion(true));
    const closed = react.render(() => useMenuMotion(false));
    expect(closed).toMatchObject({ shown: false, closing: false, exitProps: {} });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reopens at once", () => {
    react.render(() => useMenuMotion(true));
    react.render(() => useMenuMotion(false));
    expect(react.render(() => useMenuMotion(true))).toMatchObject({ shown: true, closing: false, exitProps: {} });
  });

  it("keeps the last payload of a positioned menu", () => {
    const anchor = { x: 10, y: 20 };
    react.render(() => useHeldMenuMotion(anchor));
    const closed = react.render(() => useHeldMenuMotion<typeof anchor>(null));
    expect(closed).toMatchObject({ shown: false, closing: false, value: anchor });
  });
});
