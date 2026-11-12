import assert from "node:assert/strict";
import test from "node:test";
import { bootShellHtml } from "./startup-mascot.mjs";
import { startupScreenHtml } from "./startup-screen.mjs";

test("the splash is dusk bot's meadow: a quiet scene, a live status and a still version for reduced motion", () => {
  const html = startupScreenHtml();
  assert.match(html, /<title>Dusk Bot<\/title>/);
  assert.match(html, /<h1>dusk bot<\/h1>/);
  assert.match(html, /<svg class="scene"[^>]*aria-hidden="true"/);
  assert.match(html, /role="status">opening dusk bot/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)\{\s*\.bot,\.raft,\.drift,\.kit/);
  assert.match(html, /@media\(prefers-color-scheme:dark\)/);
  assert.match(html, /data-act="retry">try again</);
  assert.match(html, /data-act="quit">quit</);
  assert.doesNotMatch(html, /OpenMaus|border:\s*1px/);
});

test("the boot shell hides itself once the app renders into #root", () => {
  const html = bootShellHtml();
  assert.match(html, /#root:not\(:empty\)\+#boot-shell\{display:none\}/);
  assert.match(html, /<div id="boot-shell" aria-hidden="true"><svg/);
});
