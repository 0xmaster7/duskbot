import { afterEach, describe, expect, it } from "vitest";

import { BotLogins, cardLoginPlace, cardSignInElsewhere, ONCE_LOGIN_MS, observeSignInPage } from "./bot-logins.ts";
import type { LoginStore } from "./login-store.ts";
import type { OnePasswordLogins } from "./onepassword.ts";
import { FakeLoginPage, LOGIN_FORM } from "./testing/fake-login-page.ts";

let page: FakeLoginPage | null = null;
afterEach(() => { page?.close(); page = null; });

describe("a login saved from a sign-in card", () => {
  it("fills on the card's site, at the sign-in page open on that site", () => {
    expect(cardLoginPlace("example.com", { host: "accounts.example.com", signIn: true }, undefined))
      .toEqual({ site: "example.com", hosts: ["accounts.example.com"], exactHost: false });
    expect(cardLoginPlace("example.com", { host: "www.example.com", signIn: false }, undefined))
      .toEqual({ site: "example.com", hosts: ["example.com"], exactHost: false });
    expect(cardLoginPlace("example.com", null, undefined)).toEqual({ site: "example.com", hosts: ["example.com"], exactHost: false });
  });

  it("adds a sign-in page on another site only when the person confirmed that host", () => {
    const microsoft = { host: "login.microsoftonline.com", signIn: true };
    expect(cardSignInElsewhere("example.com", microsoft)).toBe("login.microsoftonline.com");
    expect(cardLoginPlace("example.com", microsoft, "login.microsoftonline.com"))
      .toEqual({ site: "example.com", hosts: ["example.com", "login.microsoftonline.com"], exactHost: false });
    expect(cardLoginPlace("example.com", microsoft, undefined).hosts).toEqual(["example.com"]);
    expect(cardLoginPlace("example.com", microsoft, "evil.test").hosts).toEqual(["example.com"]);
    expect(cardSignInElsewhere("example.com", { host: "evil.test", signIn: false })).toBeNull();
    expect(cardLoginPlace("example.com", { host: "evil.test", signIn: false }, "evil.test").hosts).toEqual(["example.com"]);
  });
});

describe("the bot's open page", () => {
  it("is read as its host and whether it shows a password, username or email box, only for a page a login could be filled on", async () => {
    page = new FakeLoginPage("https://login.microsoftonline.com/common/oauth2/authorize?client_id=x", LOGIN_FORM);
    expect(await observeSignInPage((args) => page!.engine(args))).toEqual({ host: "login.microsoftonline.com", signIn: true });
    page.navigate("https://login.example.net/u/login/identifier", `<form><input name="username" autocomplete="username"><button>Continue</button></form>`);
    expect(await observeSignInPage((args) => page!.engine(args))).toEqual({ host: "login.example.net", signIn: true });
    page.navigate("https://example.com/dashboard", "<h1>Hello</h1>");
    expect(await observeSignInPage((args) => page!.engine(args))).toEqual({ host: "example.com", signIn: false });
    page.navigate("http://example.com/login", LOGIN_FORM);
    expect(await observeSignInPage((args) => page!.engine(args))).toBeNull();
    expect(await observeSignInPage(async () => null)).toBeNull();
    expect(await observeSignInPage(async () => { throw new Error("The browser did not answer."); })).toBeNull();
  });
});

describe("a login given for one task only", () => {
  function logins(clock: { now: number }) {
    const store = { usableFor: () => [], sitesFor: () => [], markUsed: () => {} } as unknown as LoginStore;
    const onePassword = { candidates: () => [], sitesFor: () => [], markUsed: () => {}, fresh: async () => {} } as unknown as OnePasswordLogins;
    return new BotLogins(store, onePassword, () => clock.now);
  }

  it("fills for its bot on its site until a fill uses it, then is gone, and never for another bot", async () => {
    const clock = { now: 1_000 };
    const all = logins(clock);
    const id = all.keepOnce("b1", "the-internet.herokuapp.com", { username: "tomsmith", password: "fake-pass", totp: null });
    expect(all.has("b1", "the-internet.herokuapp.com")).toBe(true);
    expect(all.has("b2", "the-internet.herokuapp.com")).toBe(false);
    expect(all.sitesFor("b1")).toEqual([{ site: "the-internet.herokuapp.com", hosts: ["the-internet.herokuapp.com"], exactHost: false, username: "tomsmith" }]);
    const [candidate] = await all.candidates("b1", "the-internet.herokuapp.com");
    expect(candidate).toMatchObject({ id, username: "tomsmith", source: "card" });
    expect(await candidate!.secrets()).toEqual({ password: "fake-pass", totp: null });
    expect(await all.candidates("b1", "example.com")).toEqual([]);
    all.markUsed(id);
    expect(all.has("b1", "the-internet.herokuapp.com")).toBe(false);
  });

  it("goes after an hour when no fill used it", () => {
    const clock = { now: 1_000 };
    const all = logins(clock);
    all.keepOnce("b1", "example.com", { username: "me", password: "fake-pass", totp: null });
    clock.now += ONCE_LOGIN_MS;
    expect(all.sitesFor("b1")).toEqual([]);
  });
});
