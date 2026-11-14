// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { closeSignIn, openSignIn } from "@/lib/sign-in-sheet";
import { SignInSheetHost } from "./SignInSheet";
import { AccountsSheet } from "./AccountMenu";

let host: HTMLDivElement, root: Root;
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const q = (selector: string) => document.querySelector<HTMLElement>(selector);

function desktop(status: "signed-out" | "connected" = "signed-out") {
  const gate = {
    state: vi.fn(async () => ({ required: false, blocked: false, status })),
    options: vi.fn(async () => ({ providers: ["google", "apple", "x"], recovery: true })),
    signInStart: vi.fn(async () => ({ outcome: "sent", email: "p@qa.dusk.test", resendAt: Date.now() + 30_000 })),
    signInVerify: vi.fn(async () => ({ outcome: "signed-in" })),
    signInCancel: vi.fn(async () => {}),
    browser: vi.fn(async () => ({ required: false, blocked: false, status: "connecting", browser: "apple" })),
    cancel: vi.fn(async () => ({})), reopen: vi.fn(async () => ({})),
    onChange: vi.fn(() => () => {}),
  };
  const accounts = { list: vi.fn(async () => ({ active: null, saved: [] })), onChanged: vi.fn(() => () => {}), signOut: vi.fn() };
  vi.stubGlobal("duskDesktop", { accountGate: gate, cloudAccount: { state: vi.fn(async () => ({ status })) }, accounts });
  return { gate, accounts };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); closeSignIn(); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

it("sign in opens the sign-in right here: an emailed code, Google, Apple and X, never Settings", async () => {
  const { gate } = desktop();
  await act(async () => { root.render(createElement(SignInSheetHost)); });
  expect(q("[data-sign-in-sheet]")).toBeNull();
  await act(async () => { openSignIn(); });
  await settle();
  expect(q("[data-sign-in-sheet]")).toBeTruthy();
  expect(q("[data-sign-in-sheet] input[type=email]")).toBeTruthy();
  expect([...document.querySelectorAll("[data-funnel-provider]")].map((item) => item.getAttribute("data-funnel-provider"))).toEqual(["google", "apple", "x"]);
  await act(async () => { q("[data-funnel-provider=apple]")!.click(); });
  expect(gate.browser).toHaveBeenCalledWith("apple");
});

it("signed in with the emailed code, what the person was doing goes on", async () => {
  const { gate } = desktop();
  const then = vi.fn();
  const type = async (input: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const submit = async () => act(async () => { q("[data-sign-in-sheet] form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { root.render(createElement(SignInSheetHost)); });
  await act(async () => { openSignIn({ then }); });
  await settle();
  await type(q("[data-sign-in-sheet] input[type=email]") as HTMLInputElement, "p@qa.dusk.test");
  await submit(); await settle();
  expect(gate.signInStart).toHaveBeenCalledWith("p@qa.dusk.test");
  await type(document.querySelector<HTMLInputElement>("[data-sign-in-sheet] input[inputmode=numeric]")!, "12345678");
  await submit(); await settle();
  expect(gate.signInVerify).toHaveBeenCalledWith("12345678");
  expect(then).toHaveBeenCalledTimes(1);
  expect(q("[data-sign-in-sheet]")).toBeNull();
});

it("the account sheet over a place, with nobody signed in, is the same sign-in", async () => {
  desktop();
  await act(async () => { root.render(createElement(AccountsSheet, { onClose: () => {} })); });
  await settle();
  expect(q("[data-sign-in-sheet]")).toBeTruthy();
  expect(q("[data-accounts-sheet]")).toBeNull();
});
