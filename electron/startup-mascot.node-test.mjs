import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bootShellHtml } from "./startup-mascot.mjs";
import { CREW, STEPS, startupDark, startupScreenHtml } from "./startup-screen.mjs";

test("the splash is the crew on their line, one empty spot per step, in the theme it was asked for", () => {
  const light = startupScreenHtml(), dark = startupScreenHtml({ dark: true });
  assert.deepEqual(CREW, ["goo", "kit", "pip", "mochi", "boxo"]);
  assert.equal(CREW.length, STEPS.length, "one mascot per startup step");
  assert.match(light, /<canvas class="scene" width="480" height="300" aria-hidden="true">/);
  assert.match(light, /<p class="brand">dusk bot<\/p>/);
  assert.match(light, /role="status">opening dusk bot</);
  assert.match(light, /role="progressbar" aria-valuenow="0"[^>]*aria-valuetext="0 of 5 here" aria-label="opening dusk bot"><b class="here">0 of 5<\/b> here/);
  assert.match(light, /"name":"kit","color":"#1b1b1f","eyeColor":"#ffffff"/, "kit in ink on light");
  assert.match(dark, /"name":"kit","color":"#f2f3f5","eyeColor":"#1b1b1f"/);
  assert.match(light, /"name":"goo","color":"#f75e51"/);
  assert.match(light, /--bg:#fafbfc;/); assert.match(light, /content="light"/);
  assert.match(dark, /--bg:#141418;/); assert.match(dark, /content="dark"/);
  assert.doesNotMatch(light, /prefers-color-scheme/);
  assert.match(light, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(light, /@media\(prefers-reduced-motion:reduce\)\{\.scene,\.txt\{transition:none\}\}/);
  assert.match(light, /font-src data:;/); assert.match(light, /url\("data:font\/woff2;base64,[^"]+"\)/);
  assert.match(light, /data-act="retry">try again</);
  assert.match(light, /data-act="quit">quit</);
  assert.match(light, /aria-label="Close" data-act="close"/);
  assert.match(light, /everyone's here/);
  assert.doesNotMatch(light, /\u2014|border:\s*1px|transition:all/);
});

test("every mascot has the poses the screen draws: idle, arriving, cheering, stuck and worried", () => {
  const sprites = JSON.parse(readFileSync(new URL("./resources/startup-crew.json", import.meta.url), "utf8"));
  for (const name of CREW) {
    assert.match(sprites[name].body, /^(M\d+ \d+h\d+v1h-\d+z)+$/, name);
    for (const pose of ["idle", "working", "happy", "thinking"]) assert.match(sprites[name].eyes[pose], /^(M\d+ \d+h\d+v1h-\d+z)+$/, `${name} ${pose}`);
  }
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
