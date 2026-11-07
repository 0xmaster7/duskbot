import assert from "node:assert/strict";
import test from "node:test";
import { bootShellHtml } from "./startup-mascot.mjs";
import { startupScreenHtml } from "./startup-screen.mjs";

test("the splash waits with the mascot, not a spinner", () => {
  const html = startupScreenHtml();
  assert.match(html, /<svg class="boot-mascot"[^>]*aria-hidden="true"/);
  assert.match(html, /mask="url\(#splash-mascot-eyes\)"/);
  assert.doesNotMatch(html, /spinner/);
  assert.match(html, /prefers-reduced-motion:reduce\)\{\.boot-mascot\{animation:none/);
  assert.match(html, /role="status">Opening your workspace/);
});

test("the boot shell hides itself once the app renders into #root", () => {
  const html = bootShellHtml();
  assert.match(html, /#root:not\(:empty\)\+#boot-shell\{display:none\}/);
  assert.match(html, /<div id="boot-shell" aria-hidden="true"><svg/);
});
