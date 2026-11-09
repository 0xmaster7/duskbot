// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DELETE_UNDO_MS, Toast } from "./Toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
const onDone = vi.fn();
const toast = () => document.querySelector<HTMLElement>(".ui-toast")!;

beforeEach(() => {
  vi.useFakeTimers();
  onDone.mockClear();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(createElement(Toast, { text: "Note forgotten", onDone, timeoutMs: DELETE_UNDO_MS, action: { label: "Undo", onClick: () => {} } })));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

it("goes after its time when nobody touches it", () => {
  act(() => vi.advanceTimersByTime(DELETE_UNDO_MS - 1));
  expect(onDone).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(onDone).toHaveBeenCalledOnce();
});

it("holds while the pointer is on it, then gives back only the time that was left", () => {
  act(() => vi.advanceTimersByTime(5_000));
  act(() => toast().dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
  act(() => vi.advanceTimersByTime(60_000));
  expect(onDone).not.toHaveBeenCalled();
  act(() => toast().dispatchEvent(new PointerEvent("pointerout", { bubbles: true })));
  act(() => vi.advanceTimersByTime(DELETE_UNDO_MS - 5_000 - 1));
  expect(onDone).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(onDone).toHaveBeenCalledOnce();
});

it("holds while focus is inside it", () => {
  act(() => toast().querySelector("button")!.focus());
  act(() => vi.advanceTimersByTime(60_000));
  expect(onDone).not.toHaveBeenCalled();
  act(() => (document.activeElement as HTMLElement).blur());
  act(() => vi.advanceTimersByTime(DELETE_UNDO_MS));
  expect(onDone).toHaveBeenCalledOnce();
});
