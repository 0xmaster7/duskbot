// @vitest-environment happy-dom
// No money in a chat thread, ever: a reply's work line never shows what the turn cost (that lives in Usage & Billing).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";

import type { Message } from "@/state/store";
import { DigestChip } from "./DigestChip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });

test("a priced turn's work line in the chat says nothing about money", async () => {
  const message = {
    id: "m1", role: "bot", kind: "digest", at: 1, text: "[digest]",
    digest: { turnId: "t1", botId: "b1", threadId: "th1", at: 1, durationMs: 12_000, tools: [{ name: "mcp__composio__GMAIL_FETCH_EMAILS", count: 42, failed: 0 }],
      memory: [], reply: "Done", usage: { input: 1_000, output: 200, costUsd: 0.18 }, hookCoverage: "full" },
  } as unknown as Message;
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(DigestChip, { message })));
  const text = host.textContent ?? "";
  expect(text).toMatch(/Worked for/);
  expect(text).not.toMatch(/[$€£₹¥]|\b0\.18\b|USD|cost/i);
});
