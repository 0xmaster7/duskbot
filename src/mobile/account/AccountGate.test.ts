// @vitest-environment happy-dom
import { act, createElement, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { AccountGate, mobileAccountOrigin, providersFor, useMobileAccount } from "./AccountGate";
import { PlatformContext, webPlatform, type MobilePlatform } from "../platform";

vi.mock("@/components/Avatar", () => ({ MausAvatar: () => createElement("span") }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root | null;
let platform: MobilePlatform, secrets: Map<string, string>, prefs: Map<string, string>, listener: ((url: string) => boolean) | undefined, resume: (() => void) | undefined;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const origin = "https://dusk.bot";
const account = { id: "person", email: "person@example.com" };
const token = `omc_${"t".repeat(43)}`;
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = null;
  setLocale("en"); window.history.replaceState({}, "", "/"); vi.stubEnv("VITE_DUSK_ALLOW_SIGNED_OUT", ""); vi.stubEnv("VITE_DUSK_ACCOUNT_ORIGIN", "");
  secrets = new Map(); prefs = new Map(); listener = undefined; resume = undefined;
  platform = { ...webPlatform(), native: true, kind: "ios", secrets: {
    get: async key => secrets.get(key) ?? null, set: async (key, value) => { secrets.set(key, value); }, remove: async key => { secrets.delete(key); },
  }, prefs: { get: async key => prefs.get(key) ?? null, set: async (key, value) => { prefs.set(key, value); }, remove: async key => { prefs.delete(key); } },
    onAppUrl: cb => { listener = cb; return vi.fn(); }, onResume: cb => { resume = cb; return vi.fn(); }, openExternal: vi.fn(async () => {}) };
  fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher);
});
afterEach(async () => { await act(async () => root?.unmount()); host.remove(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const gate = (children: ReactNode = createElement("p", null, "workspace")) => createElement(PlatformContext, { value: platform }, createElement(AccountGate, { children }));
const mount = (children?: ReactNode, strict = false) => act(async () => {
  root = createRoot(host); root.render(strict ? createElement(StrictMode, null, gate(children)) : gate(children));
});
const heading = () => expect(host.querySelector("h1")?.textContent).toBe("Sign in to Dusk Bot");
const typeEmail = () => act(async () => {
  const field = host.querySelector<HTMLInputElement>("input[type=email]")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, account.email);
  field.dispatchEvent(new Event("input", { bubbles: true }));
});
const submit = () => act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

const save = () => secrets.set("omb.account", JSON.stringify({ origin, token, expiresAt: Date.now() + 60_000, account, deviceId: "phone" }));

it("requires an account in the native app", async () => {
  await mount(); heading(); expect(host.textContent).not.toContain("workspace");
});
it("passes through browser children unless the development query requires an account", async () => {
  platform.native = false; platform.kind = "web";
  expect(renderToStaticMarkup(gate())).toBe("<p>workspace</p>");
  window.history.replaceState({}, "", "/?account=1"); await mount(); heading(); expect(host.textContent).not.toContain("workspace");
});
it("honors the native signed-out development override", () => {
  vi.stubEnv("VITE_DUSK_ALLOW_SIGNED_OUT", "1"); expect(renderToStaticMarkup(gate())).toBe("<p>workspace</p>");
});
it("restores an account and provides its identity through context", async () => {
  save(); fetcher.mockResolvedValue(response({}));
  function Child() { const value = useMobileAccount(); return createElement("p", null, value?.account?.email); }
  await mount(createElement(Child)); expect(host.textContent).toBe(account.email); expect(host.querySelector("h1")).toBeNull();
});
it("returns to the gate on sign-out", async () => {
  save(); fetcher.mockResolvedValue(response({}));
  function Child() { const value = useMobileAccount(); return createElement("button", { onClick: () => void value?.signOut() }, "leave"); }
  await mount(createElement(Child));
  expect(host.querySelector("button")?.textContent).toBe("leave");
  await act(async () => host.querySelector("button")!.click());
  heading(); expect(secrets.has("omb.account")).toBe(false);
});
it("handles auth links and leaves pairing links to ConnectionGate", async () => {
  await mount(); heading(); expect(listener?.("duskbot://pair?code=abc")).toBe(false);
  await act(async () => { expect(listener?.("duskbot://auth?code=abc&state=bad")).toBe(true); });
  expect(host.textContent).toContain("This sign-in expired. Please start again.");
});
it("shows children after the email and code flow", async () => {
  fetcher.mockImplementation(async input => {
    const url = String(input);
    if (url.endsWith("/v1/auth/providers")) return response({ v: 1, providers: [], signupOpen: true });
    if (url.endsWith("/sign-in/start")) return response({ cloudContractVersion: 1, attempt: "a".repeat(43), expiresIn: 600, resendAfter: 30, signupOpen: true });
    return response({ cloudContractVersion: 1, accessToken: token, expiresAt: Date.now() + 60_000, device: { id: "phone" }, account });
  });
  await mount(); await typeEmail(); await submit();
  await act(async () => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => "12345678" } });
    host.querySelector('input[aria-label="Digit 1 of 8"]')!.dispatchEvent(event);
  });
  await submit();
  expect(host.textContent).toBe("workspace");
});
const providers = (...enabled: string[]) => response({ v: 1, signupOpen: true, providers: ["google", "apple", "x"].map(id => ({ id, enabled: enabled.includes(id), comingSoon: false })) });
const buttons = () => [...host.querySelectorAll("button")].map(button => button.textContent ?? "");

it("an iPhone offers another company's sign-in only beside Sign in with Apple, and Apple leads", () => {
  expect(providersFor("ios", ["google", "apple", "x"])).toEqual(["apple", "google", "x"]);
  expect(providersFor("ios", ["google", "x"])).toEqual([]);
  expect(providersFor("ios", [])).toEqual([]);
  expect(providersFor("android", ["google", "x"])).toEqual(["google", "x"]);
});
it("shows only the sign-in buttons the service has switched on", async () => {
  fetcher.mockResolvedValue(providers("google", "apple"));
  await mount();
  expect(buttons().filter(text => text.startsWith("Continue with"))).toEqual(["Continue with Apple", "Continue with Google"]);
});
it("shows no provider button the service cannot vouch for, so none leads nowhere", async () => {
  fetcher.mockRejectedValue(new TypeError("offline"));
  await mount(); heading();
  expect(buttons().some(text => text.startsWith("Continue with"))).toBe(false);
  expect(host.querySelector("input[type=email]")).not.toBeNull();
});
it("the sign-in screen links the terms and the privacy policy and offers the demo", async () => {
  fetcher.mockResolvedValue(providers());
  await mount();
  expect(buttons()).toEqual(expect.arrayContaining(["Terms of use", "Privacy policy"]));
  await act(async () => { [...host.querySelectorAll("button")].find(button => button.textContent === "Privacy policy")!.click(); });
  expect(platform.openExternal).toHaveBeenCalledWith("https://dusk.bot/privacy");
  expect(buttons().some(text => text.startsWith("Try the demo"))).toBe(true);
});
it("the demo workspace opens without an account", async () => {
  prefs.set("omb.mobile.demo", "1");
  await mount();
  expect(host.textContent).toBe("workspace"); expect(fetcher).not.toHaveBeenCalled();
});
it("an account signed out or deleted elsewhere returns to the gate when the app comes back", async () => {
  save(); fetcher.mockResolvedValue(response({}));
  await mount(); expect(host.textContent).toBe("workspace");
  fetcher.mockResolvedValue(response({ error: "invalid_token" }, 401));
  await act(async () => { resume?.(); await new Promise(resolve => setTimeout(resolve, 0)); });
  heading(); expect(secrets.has("omb.account")).toBe(false);
});
it("a resume while the service cannot be reached keeps the account", async () => {
  save(); fetcher.mockResolvedValue(response({}));
  await mount();
  fetcher.mockRejectedValue(new TypeError("offline"));
  await act(async () => { resume?.(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(host.textContent).toBe("workspace"); expect(secrets.has("omb.account")).toBe(true);
});

it("allows only bare safe origins in the development query", () => {
  for (const value of ["http://127.0.0.1:9000", "http://localhost:3000", "http://[::1]:9000", "https://fixture.example"]) expect(mobileAccountOrigin(false, new URLSearchParams({ accountOrigin: value }))).toBe(value);
  for (const value of ["http://example.com", "https://example.com/path", "https://u:p@example.com", "file:///tmp/a", "https://example.com?x=1"]) expect(mobileAccountOrigin(false, new URLSearchParams({ accountOrigin: value }))).toBe(origin);
  expect(mobileAccountOrigin(true, new URLSearchParams({ accountOrigin: "https://fixture.example" }))).toBe(origin);
  vi.stubEnv("VITE_DUSK_ACCOUNT_ORIGIN", "https://configured.example"); expect(mobileAccountOrigin(true, new URLSearchParams())).toBe("https://configured.example");
});

it("finishes a cold-launch auth link through StrictMode effect replay", async () => {
  secrets.set("omb.account.pending", JSON.stringify({ verifier: "v".repeat(43), state: "state", provider: "google", at: Date.now(), origin }));
  let launch: string | null = "duskbot://auth?code=abc&state=state";
  platform.onAppUrl = cb => { if (launch && cb(launch)) launch = null; return () => {}; };
  fetcher.mockResolvedValue(response({ cloudContractVersion: 1, accessToken: token, expiresAt: Date.now() + 60_000, device: { id: "phone" }, account }));
  await mount(undefined, true);
  expect(host.textContent).toBe("workspace"); expect(fetcher).toHaveBeenCalledOnce();
});
