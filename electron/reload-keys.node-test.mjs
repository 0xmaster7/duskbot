import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { installReloadKeys, isReloadKey } from "./reload-keys.mjs";

const press = (fields = {}) => ({ type: "keyDown", key: "r", meta: true, control: false, alt: false, shift: false, isAutoRepeat: false, ...fields });
const contents = () => { const c = new EventEmitter(); c.reloads = 0; c.reloadIgnoringCache = () => { c.reloads += 1; }; c.isDestroyed = () => false; return c; };

test("⌘R and ⌘⇧R are the reload chord on macOS, Ctrl elsewhere", () => {
  assert.equal(isReloadKey(press(), "darwin"), true);
  assert.equal(isReloadKey(press({ shift: true, key: "R" }), "darwin"), true);
  assert.equal(isReloadKey(press({ meta: false, control: true }), "darwin"), false);
  assert.equal(isReloadKey(press({ meta: false, control: true }), "win32"), true);
  assert.equal(isReloadKey(press({ meta: false, control: true, shift: true }), "linux"), true);
  assert.equal(isReloadKey(press({ alt: true }), "darwin"), false);
  assert.equal(isReloadKey(press({ type: "keyUp" }), "darwin"), false);
  assert.equal(isReloadKey(press({ key: "t" }), "darwin"), false);
  assert.equal(isReloadKey(press({ meta: false }), "darwin"), false);
});

test("the press is swallowed and reloads the window's page without cache, once per press", () => {
  const app = new EventEmitter();
  const page = contents(), view = contents();
  const win = { webContents: page, isDestroyed: () => false };
  installReloadKeys({ app, fromContents: () => win, platform: "darwin" });
  app.emit("web-contents-created", {}, page);
  app.emit("web-contents-created", {}, view);
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  page.emit("before-input-event", event, press());
  assert.equal(event.prevented, true);
  assert.equal(page.reloads, 1);
  const held = { prevented: false, preventDefault() { this.prevented = true; } };
  page.emit("before-input-event", held, press({ isAutoRepeat: true }));
  assert.equal(held.prevented, true);
  assert.equal(page.reloads, 1);
  view.emit("before-input-event", { preventDefault() {} }, press({ shift: true }));
  assert.equal(page.reloads, 2);
  assert.equal(view.reloads, 1);
  const other = { prevented: false, preventDefault() { this.prevented = true; } };
  page.emit("before-input-event", other, press({ key: "k" }));
  assert.equal(other.prevented, false);
});
