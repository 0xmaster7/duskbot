import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { handoffPage } from "./pixel-page.mjs";

test("the link service ships the same pixel page, since it deploys without this folder", () => {
  for (const ext of ["mjs", "d.mts"]) {
    assert.equal(
      readFileSync(new URL(`../apps/link-service/src/handoff-page.${ext}`, import.meta.url), "utf8"),
      readFileSync(new URL(`./pixel-page.${ext}`, import.meta.url), "utf8"),
    );
  }
});

test("the page is script-free and carries the caller's content", () => {
  const html = handoffPage({ title: "t", mood: "ok", content: "<h1>hi</h1>" });
  assert.match(html, /<h1>hi<\/h1>/);
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /\b(src|href)="(https?:|data:)/);
});

test("the crashed-window page links back to the page that died, escaped", async () => {
  const { windowCrashedPage, RENDERER_CRASHES } = await import("./error-pages.mjs");
  const html = decodeURIComponent(windowCrashedPage('http://127.0.0.1:8799/?a="1"&b=<2>').slice("data:text/html;charset=utf-8,".length));
  assert.match(html, /href="http:\/\/127\.0\.0\.1:8799\/\?a=&quot;1&quot;&amp;b=&lt;2&gt;"/);
  assert.ok(RENDERER_CRASHES.has("crashed") && !RENDERER_CRASHES.has("clean-exit") && !RENDERER_CRASHES.has("killed"));
});
