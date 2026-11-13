import { describe, expect, it } from "vitest";
import { createHumanCheckWatch, HUMAN_CHECK_PAGE, humanCheckState, parseHumanCheckPage, readHumanCheckPage, type HumanCheckPage, type HumanCheckRef } from "./human-check-watch.ts";

const page = (over: Partial<HumanCheckPage> = {}): HumanCheckPage => ({
  title: "Pastebin.com - #1 paste tool", text: "New Paste", textLength: 4_000, nodes: 900, controls: 80, busy: false,
  scripts: [], iframes: [], selectors: [], answered: false, ...over,
});
const challenge = page({ title: "Just a moment...", text: "Performing security verification", textLength: 120, controls: 0,
  iframes: ["https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2"] });
const ref: HumanCheckRef = { botId: "b1", threadId: "t1", messageId: "m1", site: "pastebin.com", place: "browser" };

describe("whether a human check still waits on the person", () => {
  it("sees Cloudflare's interstitial, and a visible widget until it holds its answer", () => {
    expect(humanCheckState(challenge)).toBe("check");
    const form = page({ iframes: ["https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile/if/ov2"] });
    expect(humanCheckState(form)).toBe("check");
    expect(humanCheckState({ ...form, answered: true })).toBe("clear");
    expect(humanCheckState(page({ iframes: ["https://www.google.com/recaptcha/api2/anchor?k=x&size=normal"] }))).toBe("check");
  });
  it("calls an ordinary page, or one with only an invisible reCAPTCHA, clear, and a block not a check", () => {
    expect(humanCheckState(page())).toBe("clear");
    expect(humanCheckState(page({ iframes: ["https://www.google.com/recaptcha/api2/anchor?ar=1&k=x&size=invisible"] }))).toBe("clear");
    expect(humanCheckState(page({ title: "Attention Required! | Cloudflare" }))).toBe("blocked");
  });
  it("reads the engine's answer, a JSON string, possibly twice encoded", () => {
    expect(parseHumanCheckPage(JSON.stringify(JSON.stringify(challenge)))).toMatchObject({ title: "Just a moment...", iframes: challenge.iframes });
    expect(parseHumanCheckPage("not json")).toBeNull();
    expect(parseHumanCheckPage({ href: "x" })).toBeNull();
  });
});

describe("a human check card that hands back by itself", () => {
  function harness(reads: Array<HumanCheckPage | null | Error>, options: { waits?: () => boolean } = {}) {
    let clock = 0;
    let index = 0;
    const cleared: HumanCheckRef[] = [];
    const watch = createHumanCheckWatch({
      read: async () => {
        const next = reads[Math.min(index++, reads.length - 1)];
        if (next instanceof Error) throw next;
        return next ?? null;
      },
      waits: options.waits ?? (() => cleared.length === 0),
      cleared: (one) => { cleared.push(one); },
      pollMs: 1_000,
      limitMs: 60_000,
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
    });
    return { watch, cleared, get reads() { return index; } };
  }

  it("settles the card once the page is clear on two reads in a row, after the person ticked the box", async () => {
    const run = harness([challenge, challenge, page(), page()]);
    await run.watch.watch(ref);
    expect(run.cleared).toEqual([ref]);
    expect(run.reads).toBe(4);
  });

  it("does not take the gap between documents, or one clear read, for the end of the check", async () => {
    const run = harness([challenge, null, page(), challenge, page(), new Error("socket closed"), page(), page()]);
    await run.watch.watch(ref);
    expect(run.cleared).toEqual([ref]);
    expect(run.reads).toBe(8);
  });

  it("stops without settling once the card was answered another way, and gives up at its limit", async () => {
    let answered = false;
    const done = harness([challenge, challenge, page()], { waits: () => !answered });
    const watching = done.watch.watch(ref);
    answered = true;
    await watching;
    expect(done.cleared).toEqual([]);

    const stuck = harness([challenge]);
    await stuck.watch.watch(ref);
    expect(stuck.cleared).toEqual([]);
    expect(stuck.reads).toBe(60);
  });

  it("keeps one watch per card", async () => {
    const run = harness([challenge, page(), page()]);
    const first = run.watch.watch(ref);
    expect(run.watch.watching("m1")).toBe(true);
    await run.watch.watch(ref);
    await first;
    expect(run.cleared).toHaveLength(1);
    expect(run.watch.watching("m1")).toBe(false);
  });
});

describe("where a check card's page is read", () => {
  it("reads the bot's browser, its own VPS desktop's front page (closing it after), and nothing it cannot reach", async () => {
    const evals: string[] = [];
    let closed = 0;
    const deps = {
      browserEval: async (_ref: HumanCheckRef, expression: string) => { evals.push(expression); return JSON.stringify(challenge); },
      boxChrome: async (botId: string) => (botId === "b1" ? "http://127.0.0.1:9/" : null),
      open: (async () => ({ url: "https://pastebin.com/", close: () => { closed++; },
        input: { engine: async () => ({ result: JSON.stringify(page()) }), insertText: async () => {}, press: async () => {}, click: async () => {} } })) as never,
    };
    expect(await readHumanCheckPage(ref, deps)).toMatchObject({ title: "Just a moment..." });
    expect(evals).toEqual([HUMAN_CHECK_PAGE]);
    expect(await readHumanCheckPage({ ...ref, place: "cloud" }, deps)).toMatchObject({ title: page().title });
    expect(closed).toBe(1);
    expect(await readHumanCheckPage({ ...ref, place: "cloud", botId: "b2" }, deps)).toBeNull();
    expect(await readHumanCheckPage({ ...ref, place: "local" }, deps)).toBeNull();
  });
});
