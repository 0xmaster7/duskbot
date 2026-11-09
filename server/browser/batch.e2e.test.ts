// agent_browser_batch on real Chrome, and what it saves on one multi-step task against single calls.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hostTimeout } from "../testing/host-timeout.ts";
import { FixtureServer } from "./cdp/testing/fixtures.ts";
import { CHROME } from "./cdp/testing/real-chrome.ts";
import type { BrowserTarget } from "./service.ts";
import { startService, type RealService, type ToolResult } from "./testing/real-service.ts";

const suite = CHROME ? describe : describe.skip;

suite("the browser batch tool on real Chrome", () => {
  let fx: FixtureServer;
  let real: RealService;
  let bots = 0;

  beforeAll(async () => {
    fx = await FixtureServer.start();
    real = await startService();
  }, hostTimeout(240_000));

  afterAll(async () => {
    await real?.close();
    await fx?.close();
  });

  const bot = (): BrowserTarget => ({ session: `batch-${++bots}`, key: `bot:batch-${bots}` });
  const page = (path: string, body: string) => fx.page(path, `<!doctype html><meta charset="utf-8"><title>${path.slice(1)}</title>${body}`);

  /** A search that answers after a delay, a result list, and a product page with its price. */
  function shop(): string {
    page("/lamp", `<h1>Desk lamp</h1><p>Price: <span id="price">$42.00</span></p>`);
    page("/results", `<h1>Loading</h1><ul id="list"></ul><script>setTimeout(() => { document.querySelector("h1").textContent = "Results"; document.querySelector("#list").innerHTML = '<li><a href="/lamp">Desk lamp</a></li><li><a href="/chair">Chair</a></li>'; }, 400);</script>`);
    return page("/shop", `<form action="/results"><label>Search <input id="q" name="q"></label></form>`);
  }

  const singleCalls = (url: string): Array<[string, Record<string, unknown>]> => [
    ["agent_browser_open", { url }],
    ["agent_browser_fill", { selector: "#q", text: "lamp", submit: true }],
    ["agent_browser_wait", { text: "Results" }],
    ["agent_browser_click", { selector: "text=Desk lamp" }],
    ["agent_browser_read", { selector: "#price" }],
  ];

  const chars = (result: ToolResult) => result.content.reduce((sum, part) => sum + (part.text?.length ?? 0), 0);

  it("runs a search, a wait, a click and a read in one call, as five single calls do", async () => {
    const url = shop();
    const target = bot();
    const steps = singleCalls(url).map(([name, args]) => ({ do: name.replace("agent_browser_", ""), ...args }));
    const result = await real.call(target, "agent_browser_batch", { steps });
    const text = real.text(result);
    expect(result.isError).toBeUndefined();
    expect(text.split("\n")[0]).toMatch(/^Ran all 5 steps in /);
    expect(text).toMatch(/^5\. read: .*\n\$42\.00$/m);
  });

  it("stops at a step that fails and shows the page as it is", async () => {
    const url = page("/form", `<label>Name <input id="n"></label><button>Go</button>`);
    const result = await real.call(bot(), "agent_browser_batch", { steps: [{ do: "open", url }, { do: "click", selector: "#missing" }, { do: "fill", selector: "#n", text: "never" }], timeoutMs: 8_000 });
    const text = real.text(result);
    expect(result.isError).toBe(true);
    expect(text).toMatch(/^Step 2 of 3 failed, so the 1 after it did not run\./);
    expect(text).toContain("2. click failed:");
    expect(text).toMatch(/The page now:\nPage t1: "form"/);
    expect(text).toContain(`textbox "Name"`);
  });

  it("measures the same task with and without the batch tool", async () => {
    const single = { calls: 0, ms: 0, chars: 0 };
    {
      const target = bot();
      const started = performance.now();
      for (const [name, args] of singleCalls(shop())) {
        const result = await real.call(target, name, args);
        expect(result.isError, real.text(result)).toBeUndefined();
        single.calls++;
        single.chars += chars(result);
      }
      single.ms = performance.now() - started;
      expect(real.text(await real.call(target, "agent_browser_read", { selector: "#price" }))).toContain("$42.00");
    }
    const batch = { calls: 0, ms: 0, chars: 0 };
    {
      const target = bot();
      const started = performance.now();
      const result = await real.call(target, "agent_browser_batch", { steps: singleCalls(shop()).map(([name, args]) => ({ do: name.replace("agent_browser_", ""), ...args })) });
      expect(result.isError, real.text(result)).toBeUndefined();
      batch.calls++;
      batch.chars += chars(result);
      batch.ms = performance.now() - started;
      expect(real.text(result)).toContain("$42.00");
    }
    console.info(`batch measurement: single calls ${single.calls} calls, ${Math.round(single.ms)} ms, ${single.chars} chars; batch ${batch.calls} call, ${Math.round(batch.ms)} ms, ${batch.chars} chars`);
    expect(batch.calls).toBe(1);
    expect(single.calls).toBe(5);
  });
});
