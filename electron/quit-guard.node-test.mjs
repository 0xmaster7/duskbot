import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { HOLD_MS, TWICE_MS, createQuitGuard, isQuitKey } from "./quit-guard.mjs";
import { installDesktopBots } from "./desktop-bots.mjs";

function clock() {
  let at = 1_000, next = 1;
  const timers = new Map();
  return {
    now: () => at,
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, due: at + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      at += ms;
      for (const [id, timer] of Array.from(timers)) if (timer.due <= at) { timers.delete(id); timer.fn(); }
    },
  };
}

function guard(names = ["Scout"], platform = "darwin") {
  const time = clock(), hints = [], quits = [];
  let busy = names;
  const quitGuard = createQuitGuard({ busy: () => busy, hint: (shown) => hints.push(shown), quit: () => quits.push(true), platform, ...time });
  return { quitGuard, time, hints, quits, setBusy: (next) => { busy = next; } };
}

const key = (type, fields = {}) => ({ type, key: "q", meta: true, control: false, alt: false, shift: false, isAutoRepeat: false, ...fields });
const event = () => ({ prevented: false, preventDefault() { this.prevented = true; } });

test("with no bot working, one ⌘Q quits and the menu keeps its own shortcut", () => {
  const { quitGuard, quits, hints } = guard([]);
  const down = event();
  quitGuard.input(down, key("keyDown"));
  assert.equal(down.prevented, false, "the menu's own ⌘Q handles it");
  quitGuard.menu(true);
  assert.deepEqual([quits.length, hints.length], [1, 0]);
});

test("while a bot works, one ⌘Q only shows the pill; a quick release never quits", () => {
  const { quitGuard, quits, hints, time } = guard(["Scout", "Echo"]);
  const down = event();
  quitGuard.input(down, key("keyDown"));
  assert.equal(down.prevented, true, "the menu never sees it");
  assert.deepEqual(hints, [["Scout", "Echo"]]);
  quitGuard.input(event(), key("keyUp"));
  time.advance(HOLD_MS * 3);
  assert.equal(quits.length, 0);
});

test("holding ⌘Q for the hold time quits, key repeats included", () => {
  const { quitGuard, quits, time } = guard();
  quitGuard.input(event(), key("keyDown"));
  time.advance(HOLD_MS / 2);
  const repeat = event();
  quitGuard.input(repeat, key("keyDown", { isAutoRepeat: true }));
  assert.equal(repeat.prevented, true);
  assert.equal(quits.length, 0);
  time.advance(HOLD_MS / 2);
  assert.equal(quits.length, 1);
});

test("letting go of ⌘ first, or the window losing focus, ends a hold", () => {
  const { quitGuard, quits, time } = guard();
  quitGuard.input(event(), key("keyDown"));
  quitGuard.input(event(), { type: "keyUp", key: "Meta", meta: false });
  time.advance(HOLD_MS * 2);
  quitGuard.input(event(), key("keyDown"));
  time.advance(TWICE_MS + 1);
  quitGuard.release();
  time.advance(HOLD_MS * 2);
  assert.equal(quits.length, 0);
});

test("a second press soon after the first quits; a later one shows the pill again", () => {
  const { quitGuard, quits, hints, time } = guard();
  quitGuard.input(event(), key("keyDown"));
  quitGuard.input(event(), key("keyUp"));
  time.advance(TWICE_MS + 50);
  quitGuard.input(event(), key("keyDown"));
  quitGuard.input(event(), key("keyUp"));
  assert.deepEqual([quits.length, hints.length], [0, 2]);
  time.advance(TWICE_MS - 50);
  quitGuard.input(event(), key("keyDown"));
  assert.equal(quits.length, 1);
});

test("the menu's accelerator is a press that cannot be timed; a click on Quit quits at once", () => {
  const { quitGuard, quits, hints, time } = guard();
  quitGuard.menu(true);
  time.advance(HOLD_MS * 2);
  assert.deepEqual([quits.length, hints.length], [0, 1], "no key-up was seen, so no hold is timed");
  quitGuard.menu(true);
  time.advance(100);
  quitGuard.menu(true);
  assert.deepEqual([quits.length, hints.length], [1, 2]);
  quitGuard.menu(false);
  assert.equal(quits.length, 2);
});

test("only ⌘Q on macOS and Ctrl+Q elsewhere, never with Shift or Option", () => {
  assert.equal(isQuitKey(key("keyDown"), "darwin"), true);
  assert.equal(isQuitKey(key("keyDown", { key: "Q" }), "darwin"), true);
  assert.equal(isQuitKey(key("keyDown", { shift: true }), "darwin"), false);
  assert.equal(isQuitKey(key("keyDown", { alt: true }), "darwin"), false);
  assert.equal(isQuitKey(key("keyDown", { meta: false, control: true }), "darwin"), false);
  assert.equal(isQuitKey(key("keyDown", { meta: false, control: true }), "linux"), true);
  assert.equal(isQuitKey(key("keyDown", { key: "w" }), "darwin"), false);
});

test("main counts only the busy bots this computer's own page reports", () => {
  const time = clock(), listeners = new Map(), sent = [], quits = [];
  const app = Object.assign(new EventEmitter(), { quit: () => quits.push(true) });
  let local = true;
  const contents = { send: (channel, payload) => sent.push([channel, payload]), isDestroyed: () => false };
  const win = { webContents: contents, isDestroyed: () => false };
  const bots = installDesktopBots({ ipcMain: { on: (channel, fn) => listeners.set(channel, fn) }, app, window: () => win, isLocal: () => local, platform: "darwin", timers: time });
  listeners.get("desktop-bots:busy")({ sender: {} }, ["Ghost"]);
  assert.deepEqual(bots.busy(), [], "another window's page");
  listeners.get("desktop-bots:busy")({ sender: contents }, ["  Scout ", 7, ""]);
  assert.deepEqual(bots.busy(), ["Scout"]);
  const page = Object.assign(new EventEmitter(), {});
  app.emit("web-contents-created", {}, page);
  const down = event();
  page.emit("before-input-event", down, key("keyDown"));
  assert.equal(down.prevented, true);
  assert.deepEqual(sent, [["desktop-bots:quit-hint", ["Scout"]]]);
  local = false;
  assert.deepEqual(bots.busy(), [], "a server's or Cloud's page: quitting stops none of its turns");
  bots.quit(true);
  assert.equal(quits.length, 1);
});
