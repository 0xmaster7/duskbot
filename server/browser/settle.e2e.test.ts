// Page reads on real Chrome wait out loading placeholders and a bot check that clears by itself.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hostTimeout } from "../testing/host-timeout.ts";
import { FixtureServer } from "./cdp/testing/fixtures.ts";
import { CHROME } from "./cdp/testing/real-chrome.ts";
import type { BrowserTarget } from "./service.ts";
import { startService, type RealService } from "./testing/real-service.ts";

const suite = CHROME ? describe : describe.skip;

suite("settled page reads on real Chrome", () => {
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

  const bot = (): BrowserTarget => ({ session: `settle-${++bots}`, key: `bot:settle-${bots}` });
  const page = (path: string, title: string, body: string) => fx.page(path, `<!doctype html><meta charset="utf-8"><title>${title}</title>${body}`);

  it("answers open with the content a skeleton turns into, not the skeleton", async () => {
    const url = page("/skeleton", "Order", `<div id="slot"><div class="skeleton-line" style="height:20px;width:200px;background:#eee"></div></div>
      <script>setTimeout(() => { document.querySelector("#slot").innerHTML = '<p>Total: $19.99</p><button>Pay</button>'; }, 700);</script>`);
    const started = Date.now();
    const text = real.text(await real.call(bot(), "agent_browser_open", { url }));
    expect(text).toContain("Total: $19.99");
    expect(text).toContain(`button "Pay"`);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("says when placeholders were still there after 2 s", async () => {
    const url = page("/forever", "Feed", `<a href="/">home</a><div aria-busy="true" style="height:40px">loading</div>`);
    const text = real.text(await real.call(bot(), "agent_browser_open", { url }));
    expect(text).toMatch(/Parts of the page were still loading after 2 s/);
  });

  it("waits out a check that clears by itself and answers with the site behind it", async () => {
    page("/inside", "Store", `<h1>Store front</h1><a href="/cart">Cart</a>`);
    const url = page("/gate", "Just a moment...", `<div id="challenge-running">Checking if the site connection is secure</div>
      <script>setTimeout(() => location.replace("/inside"), 2_500);</script>`);
    const started = Date.now();
    const text = real.text(await real.call(bot(), "agent_browser_open", { url }));
    expect(text).toMatch(/The site ran a Cloudflare bot check first; it cleared by itself after [23] s\./);
    expect(text).toContain(`heading "Store front"`);
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  it("does not wait on a check a person must answer, and says not to solve it", async () => {
    const url = page("/hold", "Access to this page has been denied", `<p>Press and hold to confirm you are a human</p><div id="px-captcha" style="width:300px;height:50px"></div>`);
    const started = Date.now();
    const text = real.text(await real.call(bot(), "agent_browser_open", { url }));
    expect(text).toMatch(/The site shows a PerimeterX check that a person must answer\. Never try to solve or get around it/);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("reads a page that settled the same way", async () => {
    const url = page("/late", "Late", `<a href="/">home</a><div id="slot"><span class="spinner">…</span></div>
      <script>setTimeout(() => { document.querySelector("#slot").textContent = "Delivered on Monday"; }, 600);</script>`);
    const text = real.text(await real.call(bot(), "agent_browser_read", { url }));
    expect(text).toContain("Delivered on Monday");
  });
});
