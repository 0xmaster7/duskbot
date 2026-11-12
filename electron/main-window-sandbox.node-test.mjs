import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

// security: the main window's renderer shows remote places and bot-written content, so it never gets Node.
test("the main window's renderer is sandboxed with no Node and no webview tag", () => {
  const source = fs.readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  const prefs = source.match(/webPreferences: \{\n\s+contextIsolation: true,[\s\S]*?preload: path\.join\(__dirname, "preload\.cjs"\)/)?.[0];
  assert.ok(prefs, "main window webPreferences not found");
  assert.match(prefs, /sandbox: true/);
  assert.match(prefs, /nodeIntegration: false/);
  assert.match(prefs, /webviewTag: false/);
});
