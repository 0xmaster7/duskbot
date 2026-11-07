import { afterEach, describe, expect, it, vi } from "vitest";

import type { Surface } from "../../shared/wire.ts";
import type { BotRecord } from "../store.ts";
import { FakeLoginPage, LOGIN_FORM } from "../testing/fake-login-page.ts";
import { createFillLoginTurn, DESKTOP_TAKEN, type FillLoginTurnDeps } from "./fill-login-turn.ts";

const turn = { botId: "b1", threadId: "t1", generation: "g1" };
const bot = { id: "b1", name: "Statements", browser: true, browserProfile: "bank" } as unknown as BotRecord;
const BANK = { site: "bank.test", hosts: ["bank.test"], exactHost: false, username: "person@example.test" };

function harness(over: Partial<FillLoginTurnDeps> & { at?: Surface | null } = {}) {
  const moveToBrowser = vi.fn(over.moveToBrowser ?? (() => true));
  const target = vi.fn(over.target ?? (async () => null));
  const deps: FillLoginTurnDeps = {
    place: () => (over.at === undefined ? "local" : over.at),
    current: (b) => b,
    builtInBrowserOn: () => true,
    browserSelectable: () => true,
    myChrome: () => false,
    claim: () => true,
    withSecretInput: (_session, _spec, fill) => fill(),
    logins: { sitesFor: () => [BANK], candidates: async () => [], markUsed: () => {} },
    onePasswordTrouble: () => undefined,
    loginInput: () => ({ engine: async () => null, insertText: async () => {}, press: async () => {}, click: async () => {} }),
    remember: () => {},
    stepContext: () => ({ botId: "b1", botName: "Statements", threadId: "t1", generation: "g1", turnId: () => null, record: false }),
    ...over,
    moveToBrowser,
    target,
  };
  return { fill: createFillLoginTurn(deps).fillLoginForTurn, moveToBrowser, target };
}

describe("fill_login outside the bot's own browser", () => {
  it.each(["local", "vm", "cloud"] as const)("moves a request on %s to the bot's browser and tells the bot to end the turn", async (at) => {
    const { fill, moveToBrowser, target } = harness({ at });
    const answer = await fill(bot, turn, undefined, undefined);
    expect(moveToBrowser).toHaveBeenCalledWith(turn);
    expect(target).not.toHaveBeenCalled();
    expect(answer.ok).toBe(false);
    expect(answer.text).toContain("never types one on the screen of");
    expect(answer.text).toContain("moving this conversation to your own browser");
    expect(answer.text).toContain("End this turn now");
    expect(answer.text).not.toContain("request_sign_in");
  });

  it("names the person's own Chrome when the bot's profile is My Chrome", async () => {
    const { fill } = harness({ myChrome: () => true });
    expect((await fill(bot, turn, undefined, undefined)).text).toContain("the person's own Chrome (My Chrome)");
  });

  it("asks for a sign-in on the screen when this run cannot move, without moving it", async () => {
    const { fill, moveToBrowser } = harness({ moveToBrowser: () => false });
    const answer = await fill(bot, turn, undefined, undefined);
    expect(moveToBrowser).toHaveBeenCalledOnce();
    expect(answer.text).toContain("this run cannot move to your browser");
    expect(answer.text).toContain("Call request_sign_in so the person signs in on this computer.");
  });

  it("never moves when the bot has no login to fill, and says 1Password could not be read", async () => {
    const { fill, moveToBrowser } = harness({
      logins: { sitesFor: () => [], candidates: async () => [], markUsed: () => {} },
      onePasswordTrouble: () => "Could not reach 1Password. Check the internet connection and try again.",
    });
    const answer = await fill(bot, turn, undefined, undefined);
    expect(moveToBrowser).not.toHaveBeenCalled();
    expect(answer.text).toBe("You have no saved logins to fill (1Password could not be read just now: Could not reach 1Password. Check the internet connection and try again.). Call request_credential with credential_id \"login\" and the site: the person types the username and password on a secure card (saved to their Vault unless they untick it), you never see them, and you are resumed to call fill_login. Use request_sign_in instead only for a step no login can fill (a CAPTCHA, a passkey, an approval on their phone, an OAuth consent) or when they would rather sign in themselves. They can also sign in themselves on this computer with request_sign_in.");
  });

  it("never moves when the bot's browser cannot be its place, and says why", async () => {
    const off = harness({ browserSelectable: () => false, builtInBrowserOn: () => false });
    const answer = await off.fill(bot, turn, undefined, undefined);
    expect(off.moveToBrowser).not.toHaveBeenCalled();
    expect(answer.text).toContain("the built-in browser is off for you here");
    const missing = harness({ browserSelectable: () => false });
    expect((await missing.fill(bot, turn, undefined, undefined)).text).toContain("it is not installed yet, or this AI model cannot use browser tools");
    expect(missing.moveToBrowser).not.toHaveBeenCalled();
  });

  it("keeps the plain answer for a conversation with no place at all", async () => {
    const { fill } = harness({ at: null, browserSelectable: () => false });
    expect(await fill(bot, turn, undefined, undefined)).toEqual({ ok: false, text: "fill_login works in the built-in browser, and this conversation has none. Call request_sign_in instead." });
  });
});

describe("fill_login in the bot's own browser", () => {
  it("fills there and never asks to move", async () => {
    const { fill, moveToBrowser, target } = harness({ at: "browser" });
    const answer = await fill(bot, turn, undefined, undefined);
    expect(moveToBrowser).not.toHaveBeenCalled();
    expect(target).toHaveBeenCalledOnce();
    expect(answer).toEqual({ ok: false, text: "The browser is not available on this computer right now. Call request_sign_in instead." });
  });

  it("says 1Password could not be read when no login matches the page", async () => {
    const { fill } = harness({
      at: "browser",
      target: async () => ({ session: "bot-b1", spec: { command: "agent-browser", env: {} }, env: {} }),
      loginInput: () => ({ engine: async () => ({ url: "https://bank.test/sign-in" }), insertText: async () => {}, press: async () => {}, click: async () => {} }),
      onePasswordTrouble: () => "1Password is limiting requests right now. Try again in a few minutes.",
    });
    const answer = await fill(bot, turn, undefined, undefined);
    expect(answer.ok).toBe(false);
    expect(answer.text).toContain("No saved login for bank.test.");
    expect(answer.text).toContain("1Password could not be read just now, so its logins may be missing: 1Password is limiting requests right now.");
  });
});

describe("fill_login on the bot's own VPS desktop", () => {
  const PASSWORD = "fake-Vps!pass";
  let page: FakeLoginPage | null = null;
  afterEach(() => { page?.close(); page = null; });

  function onDesktop(over: Partial<FillLoginTurnDeps> = {}) {
    page = new FakeLoginPage("https://bank.test/sign-in", LOGIN_FORM);
    page.answer = () => ({ navigate: { url: "https://bank.test/home", html: "<title>Home</title><h1>Signed in</h1>" } });
    const current = page;
    const finish = vi.fn();
    const markUsed = vi.fn();
    const desktop = vi.fn(async () => ({
      input: { engine: (args: string[]) => current.engine(args), insertText: (text: string) => current.insertText(text), press: (key: string) => current.press(key), click: (selector: string) => current.click(selector) },
      finish,
    }));
    const h = harness({
      at: "cloud",
      logins: { sitesFor: () => [BANK], candidates: async (_bot, host) => host === "bank.test" ? [{ ...BANK, id: "l1", source: "card", secrets: async () => ({ password: PASSWORD, totp: null }) }] : [], markUsed },
      desktop,
      ...over,
    });
    return { ...h, page: current, finish, markUsed, desktop };
  }

  it("fills and submits in the desktop's Chromium, never moving the conversation or telling anyone to choose Browser", async () => {
    const { fill, moveToBrowser, target, page: shown, finish, markUsed } = onDesktop();
    const answer = await fill(bot, turn, undefined, undefined);
    expect(answer.ok).toBe(true);
    expect(answer.text).toContain("Filled the username and the password for person@example.test on bank.test and submitted it");
    expect(answer.text).not.toMatch(/Browser|moving this conversation/u);
    expect(moveToBrowser).not.toHaveBeenCalled();
    expect(target).not.toHaveBeenCalled();
    expect(shown.typed).toEqual(["person@example.test", PASSWORD]);
    expect(markUsed).toHaveBeenCalledWith("l1");
    expect(finish).toHaveBeenCalledOnce();
    // the password went in as typing only: never in a page script or the bot's answer
    expect(JSON.stringify(shown.engineCalls)).not.toContain(PASSWORD);
    expect(JSON.stringify(answer)).not.toContain(PASSWORD);
  });

  it("asks for a login on the sealed card when the bot has none, without opening the desktop", async () => {
    const { fill, desktop } = onDesktop({ logins: { sitesFor: () => [], candidates: async () => [], markUsed: () => {} } });
    const answer = await fill(bot, turn, undefined, undefined);
    expect(desktop).not.toHaveBeenCalled();
    expect(answer.ok).toBe(false);
    expect(answer.text).toContain('Call request_credential with credential_id "login" and the site');
  });

  it("passes on the desktop's refusal, such as the person holding the computer", async () => {
    const { fill } = onDesktop({ desktop: async () => ({ refusal: "The person is using your computer right now. Wait for them to hand it back, then call fill_login again." }) });
    expect(await fill(bot, turn, undefined, undefined)).toEqual({ ok: false, text: "The person is using your computer right now. Wait for them to hand it back, then call fill_login again." });
  });

  it("stops, clears the page and lets the computer go when the person takes control mid-fill", async () => {
    const { page: shown, finish } = onDesktop();
    let typed = 0;
    const desktop = async () => ({
      input: { engine: (args: string[]) => shown.engine(args), insertText: async (text: string) => { if (++typed > 1) throw new Error(DESKTOP_TAKEN); await shown.insertText(text); }, press: (key: string) => shown.press(key), click: (selector: string) => shown.click(selector) },
      finish,
    });
    const taken = harness({ at: "cloud", logins: { sitesFor: () => [BANK], candidates: async () => [{ ...BANK, id: "l1", source: "card", secrets: async () => ({ password: PASSWORD, totp: null }) }], markUsed: () => {} }, desktop });
    const answer = await taken.fill(bot, turn, undefined, undefined);
    expect(answer.ok).toBe(false);
    expect(answer.text).toContain("The person took control of your computer");
    expect(finish).toHaveBeenCalledOnce();
    expect(shown.typed).toEqual(["person@example.test"]);
  });

  it("falls back to the screen answer when the desktop has no Chromium the server reaches", async () => {
    const { fill } = onDesktop({ desktop: async () => null, browserSelectable: () => false });
    const answer = await fill(bot, turn, undefined, undefined);
    expect(answer.ok).toBe(false);
    expect(answer.text).toContain("Call request_sign_in so the person signs in on");
    expect(answer.text).not.toContain("choose Browser");
  });
});
