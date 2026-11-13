import assert from "node:assert/strict";
import test from "node:test";

import { activateExistingWindow, bringToFront, windowToReveal } from "./single-instance.mjs";

function fakeWindow({ destroyed = false, minimized = false, focused = false } = {}) {
  const calls = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    isFocused: () => focused,
    restore: () => calls.push("restore"),
    show: () => calls.push("show"),
    focus: () => calls.push("focus"),
  };
}

test("shows and focuses the only living window", () => {
  const win = fakeWindow();
  assert.equal(activateExistingWindow([win]), true);
  assert.deepEqual(win.calls, ["show", "focus"]);
});

test("restores a minimized window before showing it", () => {
  const win = fakeWindow({ minimized: true });
  assert.equal(activateExistingWindow([win]), true);
  assert.deepEqual(win.calls, ["restore", "show", "focus"]);
});

test("skips destroyed windows without touching them", () => {
  const dead = fakeWindow({ destroyed: true });
  const alive = fakeWindow();
  assert.equal(activateExistingWindow([dead, alive]), true);
  assert.deepEqual(dead.calls, []);
  assert.deepEqual(alive.calls, ["show", "focus"]);
});

test("prefers the focused window among several", () => {
  const first = fakeWindow();
  const second = fakeWindow({ focused: true });
  assert.equal(activateExistingWindow([first, second]), true);
  assert.deepEqual(first.calls, []);
  assert.deepEqual(second.calls, ["show", "focus"]);
});

test("reports failure when no window can be activated", () => {
  const dead = fakeWindow({ destroyed: true });
  assert.equal(activateExistingWindow([]), false);
  assert.equal(activateExistingWindow([dead]), false);
  assert.deepEqual(dead.calls, []);
});

function appWindow({ destroyed = false, minimized = false, focused = false, visible = true, fullScreen = false } = {}) {
  const calls = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    isFocused: () => focused,
    isVisible: () => visible,
    isFullScreen: () => fullScreen,
    restore: () => { minimized = false; calls.push("restore"); },
    show: () => { visible = true; calls.push("show"); },
    focus: () => { focused = true; calls.push("focus"); },
    setVisibleOnAllWorkspaces: (on) => calls.push(on ? "all-spaces" : "this-space"),
  };
}
function fakeApp() {
  const calls = [];
  return { calls, show: () => calls.push("show"), focus: (options) => calls.push(`focus:${options?.steal === true}`) };
}

test("a Dock click brings the main window, not the island or dock, when only those are up", () => {
  const main = appWindow({ minimized: true, visible: false });
  const viewer = appWindow({ focused: true });
  assert.equal(windowToReveal({ splash: null, main, others: [viewer, main] }), main);
});

test("the startup card stands in for the window while it is up", () => {
  const splash = appWindow();
  const main = appWindow({ visible: false });
  assert.equal(windowToReveal({ splash, main, others: [main, splash] }), splash);
  assert.equal(windowToReveal({ splash: appWindow({ destroyed: true }), main, others: [] }), main);
});

test("with the main window closed, another app window comes forward, else none (and one is made)", () => {
  const other = appWindow();
  assert.equal(windowToReveal({ main: appWindow({ destroyed: true }), others: [other] }), other);
  assert.equal(windowToReveal({ main: null, others: [] }), null);
  assert.equal(bringToFront(null, { app: fakeApp(), platform: "darwin" }), false);
});

test("on macOS a minimized, hidden window is unhidden, restored, fitted, moved to this Space, shown and focused", () => {
  const win = appWindow({ minimized: true, visible: false });
  const app = fakeApp();
  const fitted = [];
  assert.equal(bringToFront(win, { app, platform: "darwin", fit: (target) => fitted.push(target) }), true);
  assert.deepEqual(app.calls, ["show", "focus:true"]);
  assert.deepEqual(win.calls, ["restore", "all-spaces", "show", "this-space", "focus"]);
  assert.deepEqual(fitted, [win]);
});

test("a window already in front, or full screen on its own Space, is not moved between Spaces", () => {
  const front = appWindow({ focused: true });
  bringToFront(front, { app: fakeApp(), platform: "darwin" });
  assert.deepEqual(front.calls, ["show", "focus"]);
  const full = appWindow({ fullScreen: true });
  bringToFront(full, { app: fakeApp(), platform: "darwin" });
  assert.deepEqual(full.calls, ["show", "focus"]);
});

test("elsewhere it only restores, shows and focuses", () => {
  const win = appWindow({ minimized: true });
  const app = fakeApp();
  bringToFront(win, { app, platform: "win32" });
  assert.deepEqual(win.calls, ["restore", "show", "focus"]);
  assert.deepEqual(app.calls, []);
});
