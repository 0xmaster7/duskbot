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
