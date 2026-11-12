import assert from "node:assert/strict";
import test from "node:test";
import { bootShellHtml } from "./startup-mascot.mjs";
import { startupScreenHtml } from "./startup-screen.mjs";

test("the splash is a pixel postcard: the scene, kit and pip, one status line and a still version for reduced motion", () => {
  const html = startupScreenHtml();
  assert.match(html, /<svg class="kit"[^>]*aria-hidden="true"/);
  assert.match(html, /role="status">opening…/);
  assert.match(html, /url\("data:image\/png;base64,[^"]+"\)/);
  assert.match(html, /<svg class="pip"[^>]*aria-hidden="true"/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)\{\.cloud,\.pip,\.shadow,\.eyes,\.talk\{animation:none\}\}/);
  assert.match(html, /@media\(prefers-color-scheme:dark\)/);
  assert.match(html, /data-act="retry">try again</);
  assert.match(html, /data-act="quit">quit</);
  assert.doesNotMatch(html, /dusk bot|>dusk bot<|border:\s*1px/);
});

test("the boot shell hides itself once the app renders into #root", () => {
  const html = bootShellHtml();
  assert.match(html, /#root:not\(:empty\)\+#boot-shell\{display:none\}/);
  assert.match(html, /<div id="boot-shell" aria-hidden="true"><svg/);
});
