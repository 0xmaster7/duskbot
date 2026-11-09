import { describe, expect, it, vi } from "vitest";

import { runBatch, type BatchDeps } from "./batch.ts";
import { DriverError } from "./cdp/errors.ts";
import { BROWSER_CONTROL_REFUSAL } from "./control.ts";
import type { ToolContext } from "./dispatch.ts";
import { errorResult, textResult, type ToolResult } from "./shape.ts";
import type { BatchStep, ToolCall } from "./tools.ts";

function context(deadline = Date.now() + 120_000, checkpoint?: () => void): ToolContext {
  return { deadline, ...(checkpoint ? { checkpoint } : {}) } as unknown as ToolContext;
}

function deps(answer: (call: ToolCall) => ToolResult | Promise<ToolResult>): BatchDeps & { calls: ToolCall[] } {
  const calls: ToolCall[] = [];
  return {
    calls,
    execute: async (_context, call) => { calls.push(call); return answer(call); },
    failure: (error) => (error instanceof DriverError ? errorResult(error.message) : null),
  };
}

const texts = (result: ToolResult) => result.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`));

describe("a browser batch", () => {
  it("runs every step in order and answers with each step's result", async () => {
    const run = deps((call) => textResult(`did ${call.name}`));
    const steps: BatchStep[] = [{ do: "open", url: "example.com" }, { do: "fill", selector: "#q", text: "hi" }, { do: "press", key: "Enter" }];
    const result = await runBatch(context(), { steps }, run);
    expect(result.isError).toBeUndefined();
    expect(run.calls.map((call) => call.name)).toEqual(["agent_browser_open", "agent_browser_fill", "agent_browser_press"]);
    expect(texts(result)).toEqual([expect.stringMatching(/^Ran all 3 steps in \d+\.\d s\.$/), "1. open: did agent_browser_open", "2. fill: did agent_browser_fill", "3. press: did agent_browser_press"]);
  });

  it("stops at the first failure, thrown or answered, and ends with the page's snapshot", async () => {
    const run = deps((call) => {
      if (call.name === "agent_browser_click") throw new DriverError("not-found", "No element matches #missing.");
      return textResult(call.name === "agent_browser_snapshot" ? "Page t1: tree" : "ok");
    });
    const steps: BatchStep[] = [{ do: "open", url: "example.com" }, { do: "click", selector: "#missing" }, { do: "fill", selector: "#q", text: "never" }];
    const result = await runBatch(context(), { steps }, run);
    expect(result.isError).toBe(true);
    expect(run.calls.map((call) => call.name)).toEqual(["agent_browser_open", "agent_browser_click", "agent_browser_snapshot"]);
    expect(texts(result)).toEqual([
      "Step 2 of 3 failed, so the 1 after it did not run. The 1 before it ran.",
      "1. open: ok",
      "2. click failed: No element matches #missing.",
      "The page now:\nPage t1: tree",
    ]);
  });

  it("stops when a person takes the browser, without reading the page they hold", async () => {
    const run = deps((call) => { if (call.name === "agent_browser_fill") throw new Error(BROWSER_CONTROL_REFUSAL); return textResult("ok"); });
    const result = await runBatch(context(), { steps: [{ do: "open" }, { do: "fill", selector: "#q", text: "x" }, { do: "press", key: "Enter" }] }, run);
    expect(result.isError).toBe(true);
    expect(run.calls.map((call) => call.name)).toEqual(["agent_browser_open", "agent_browser_fill"]);
    expect(texts(result)).toEqual(["A person took control of the browser at step 2 of 3, so the steps after it did not run. Step 2 may already have taken effect: check the page before repeating it.", "1. open: ok", BROWSER_CONTROL_REFUSAL]);
  });

  it("starts no step once its time is up, and gives each step only the batch's deadline", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    try {
      const deadlines: number[] = [];
      const run: BatchDeps = {
        execute: async (given, call) => { if (call.name !== "agent_browser_snapshot") { deadlines.push(given.deadline); vi.advanceTimersByTime(2_500); } return textResult("ok"); },
        failure: () => null,
      };
      const result = await runBatch(context(1_000_000 + 120_000), { steps: Array.from({ length: 5 }, () => ({ do: "wait" as const, ms: 10 })), timeoutMs: 5_000 }, run);
      expect(deadlines).toEqual([1_005_000, 1_005_000]);
      expect(result.isError).toBe(true);
      expect(texts(result)[0]).toBe("The batch reached its 5.0 s limit before step 3 of 5; it and the steps after it did not run.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks before each later step whether the call may still act", async () => {
    const checkpoint = vi.fn(() => { if (checkpoint.mock.calls.length === 2) throw new Error("the turn ended"); });
    const run = deps(() => textResult("ok"));
    await expect(runBatch(context(undefined, checkpoint), { steps: [{ do: "snapshot" }, { do: "snapshot" }, { do: "snapshot" }] }, run)).rejects.toThrow("the turn ended");
    expect(run.calls).toHaveLength(2);
  });

  it("keeps the whole answer bounded however many steps run, and keeps pictures", async () => {
    const run = deps((call) => (call.name === "agent_browser_screenshot"
      ? { content: [{ type: "text", text: "shot" }, { type: "image", data: "AAAA", mimeType: "image/png" }] }
      : textResult("x".repeat(30_000))));
    const steps: BatchStep[] = [...Array.from({ length: 199 }, () => ({ do: "read" as const })), { do: "screenshot" }];
    const result = await runBatch(context(), { steps }, run);
    const text = texts(result).join("");
    expect(text.length).toBeLessThan(64_000);
    expect(text).toMatch(/The answers of \d+ later steps \(\d+ to 200\) were left out/);
    expect(result.content.filter((part) => part.type === "image")).toHaveLength(1);
  });
});
