// A human check card hands back by itself on real Chrome: the watch reads the page through fill_login's reads, sees the
// check, and settles once the page behind it loads, without anyone pressing Done.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHumanCheckWatch, HUMAN_CHECK_PAGE, humanCheckState, parseHumanCheckPage, type HumanCheckRef } from "../host/human-check-watch.ts";
import { hostTimeout } from "../testing/host-timeout.ts";
import { FixtureServer } from "./cdp/testing/fixtures.ts";
import { CHROME } from "./cdp/testing/real-chrome.ts";
import type { BrowserTarget } from "./service.ts";
import { startService, type RealService } from "./testing/real-service.ts";

const suite = CHROME ? describe : describe.skip;

suite("a human check that clears while its card waits, on real Chrome", () => {
  let fx: FixtureServer;
  let real: RealService;

  beforeAll(async () => {
    fx = await FixtureServer.start();
    real = await startService();
  }, hostTimeout(240_000));

  afterAll(async () => {
    await real?.close();
    await fx?.close();
  });

  it("sees the check, then settles the card once the site behind it loads", async () => {
    const target: BrowserTarget = { session: "human-check", key: "bot:human-check" };
    const page = (path: string, title: string, body: string) => fx.page(path, `<!doctype html><meta charset="utf-8"><title>${title}</title>${body}`);
    page("/paste", "Pastebin", `<h1>New paste</h1><textarea name="paste"></textarea><button>Create</button>`);
    // stands in for the person ticking the box: the check lets the page through a few seconds after it loads
    const gate = page("/gate", "Just a moment...", `<div id="challenge-running">Performing security verification</div>
      <script>setTimeout(() => location.replace("/paste"), 3_000);</script>`);
    const start = page("/start", "Start", `<a href="${gate}">go</a><script>setTimeout(() => { location.href = ${JSON.stringify(gate)}; }, 300);</script>`);
    await real.call(target, "agent_browser_open", { url: start });

    const engine = real.service.loginDeps(target).engine;
    const readPage = async () => parseHumanCheckPage((await engine(["eval", HUMAN_CHECK_PAGE]).catch(() => null))?.result);
    // the card is asked for while the check shows
    for (let tries = 0; tries < 40; tries++) {
      const shown = await readPage();
      if (shown && humanCheckState(shown) === "check") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const states: string[] = [];
    const cleared: HumanCheckRef[] = [];
    const ref: HumanCheckRef = { botId: "b1", threadId: "t1", messageId: "m1", site: "127.0.0.1", place: "browser" };
    const watch = createHumanCheckWatch({
      read: async () => {
        const read = await readPage();
        if (read) states.push(humanCheckState(read));
        return read;
      },
      waits: () => cleared.length === 0,
      cleared: (one) => { cleared.push(one); },
      pollMs: 500,
      limitMs: 20_000,
    });
    const started = Date.now();
    await watch.watch(ref);
    expect(cleared).toEqual([ref]);
    expect(states[0]).toBe("check");
    expect(states.slice(-2)).toEqual(["clear", "clear"]);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, hostTimeout(60_000));
});
