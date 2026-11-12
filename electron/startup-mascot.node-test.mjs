import assert from "node:assert/strict";
import test from "node:test";
import { bootShellHtml } from "./startup-mascot.mjs";
import { startupDark, startupScreenHtml } from "./startup-screen.mjs";

test("the splash is the coral blob over one slim bar, in the theme it was asked for, still for reduced motion", () => {
  const light = startupScreenHtml(), dark = startupScreenHtml({ dark: true });
  assert.match(light, /<svg class="m"[^>]*aria-hidden="true"><path fill="#f75e51"/);
  assert.match(light, /role="status">opening dusk bot</);
  assert.match(light, /role="progressbar" aria-valuenow="0"[^>]*aria-label="opening dusk bot"/);
  assert.match(light, /step 1 of 5/);
  assert.match(light, /--bg:#fafbfc;/); assert.match(light, /content="light"/);
  assert.match(dark, /--bg:#141418;/); assert.match(dark, /--fill:#c9f63f;/); assert.match(dark, /content="dark"/);
  assert.doesNotMatch(light, /prefers-color-scheme/);
  assert.match(light, /@media\(prefers-reduced-motion:reduce\)\{\.m,\.floor,\.e\{animation:none\}\.bar i\{transition:none\}\}/);
  assert.match(light, /font-src data:;/); assert.match(light, /url\("data:font\/woff2;base64,[^"]+"\)/);
  assert.match(light, /data-act="retry">try again</);
  assert.match(light, /data-act="quit">quit</);
  assert.doesNotMatch(light, /\u2014|border:\s*1px/);
});

test("the card is dark for a dark system, unless the last skin went against the system on purpose", () => {
  assert.equal(startupDark({ systemDark: true, saved: null }), true);
  assert.equal(startupDark({ systemDark: false, saved: { light: false } }), false);
  assert.equal(startupDark({ systemDark: false, saved: { light: false, systemDark: true } }), false, "followed the system then, follows it now");
  assert.equal(startupDark({ systemDark: true, saved: { light: true, systemDark: false } }), true);
  assert.equal(startupDark({ systemDark: true, saved: { light: true, systemDark: true } }), false, "a light pick on a dark system stays light");
  assert.equal(startupDark({ systemDark: false, saved: { light: false, systemDark: false } }), true);
});

test("the boot shell hides itself once the app renders into #root", () => {
  const html = bootShellHtml();
  assert.match(html, /#root:not\(:empty\)\+#boot-shell\{display:none\}/);
  assert.match(html, /<div id="boot-shell" aria-hidden="true"><svg/);
});
