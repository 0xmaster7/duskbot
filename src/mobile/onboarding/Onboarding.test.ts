// @vitest-environment happy-dom
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { AccountGate } from "../account/AccountGate";
import { SignInOffer, SIGN_IN_OFFER_KEY } from "../account/SignInOffer";
import { PlatformContext, webPlatform, type MobilePlatform } from "../platform";
import { firstStep, Onboarding } from "./Onboarding";

vi.mock("@/components/Avatar", () => ({ MausAvatar: () => createElement("span"), BotAvatar: () => createElement("span") }));
// steps swap without waiting on exit animations, so each choice lands on its screen at once
vi.mock("motion/react", async (original) => {
  const actual = await original<typeof import("motion/react")>();
  const strip = ({ initial: _i, animate: _a, exit: _e, transition: _t, whileTap: _w, variants: _v, layout: _l, ...rest }: Record<string, unknown>) => rest;
  const motion = new Proxy({}, { get: (_, tag: string) => (props: Record<string, unknown>) => createElement(tag, strip(props)) });
  return { ...actual, motion, AnimatePresence: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children), useReducedMotion: () => true };
});
vi.mock("../connection/pair", async (original) => ({
  ...await original<typeof import("../connection/pair")>(),
  redeemPairing: vi.fn(async (payload: { name?: string }) => ({ record: { id: "linked", label: payload.name ?? "" }, token: "session" })),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const origin = "https://dusk.bot";
const account = { id: "person", email: "person@example.com" };
const token = `omc_${"t".repeat(43)}`;
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let host: HTMLDivElement, root: Root, platform: MobilePlatform, prefs: Map<string, string>, secrets: Map<string, string>;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  setLocale("en"); window.history.replaceState({}, "", "/");
  vi.stubEnv("VITE_DUSK_ALLOW_SIGNED_OUT", ""); vi.stubEnv("VITE_DUSK_ACCOUNT_ORIGIN", "");
  host = document.createElement("div"); document.body.append(host);
  prefs = new Map(); secrets = new Map();
  platform = { ...webPlatform(), native: true, kind: "android",
    prefs: { get: async (key) => prefs.get(key) ?? null, set: async (key, value) => { prefs.set(key, value); }, remove: async (key) => { prefs.delete(key); } },
    secrets: { get: async (key) => secrets.get(key) ?? null, set: async (key, value) => { secrets.set(key, value); }, remove: async (key) => { secrets.delete(key); } },
    onAppUrl: () => () => {}, onResume: () => () => {}, openExternal: vi.fn(async () => {}), camera: undefined };
  fetcher = vi.fn<typeof fetch>(async () => response({ v: 1, providers: [], signupOpen: true })); vi.stubGlobal("fetch", fetcher);
});
afterEach(async () => { await act(async () => root?.unmount()); host.remove(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

const mount = (child: ReactNode) => act(async () => {
  root = createRoot(host);
  root.render(createElement(PlatformContext, { value: platform }, createElement(AccountGate, null, child)));
});
const onboarding = (props: Partial<Parameters<typeof Onboarding>[0]> = {}) => createElement(Onboarding, { onLinked: vi.fn(), ...props });
const entries = () => [...host.querySelectorAll<HTMLButtonElement>("[data-entry]")];
const press = (selector: string) => act(async () => { host.querySelector<HTMLButtonElement>(selector)!.click(); });
const heading = () => host.querySelector("h1")?.textContent;

it("offers three equal ways in up front: scan, code, or log in", async () => {
  await mount(onboarding());
  expect(entries().map((button) => button.dataset.entry)).toEqual(["scan", "code", "signin"]);
  expect(entries().map((button) => button.textContent)).toEqual(["scan a QR code", "enter a code", "log in"]);
  expect(new Set(entries().map((button) => button.className)).size).toBe(1);
  expect(host.textContent).toContain("try the demo");
});

it("log in opens the account sign-in straight away", async () => {
  await mount(onboarding());
  await press("[data-entry=signin]");
  expect(heading()).toBe("log in to dusk");
  expect(host.querySelector("input[type=email]")).not.toBeNull();
});

it("enter a code opens the code field straight away, with no intro in between", async () => {
  await mount(onboarding());
  await press("[data-entry=code]");
  expect(heading()).toBe("enter the code");
  expect(host.querySelector("input[autocomplete=one-time-code]")).not.toBeNull();
});

it("scan without a camera falls back to the code field", async () => {
  await mount(onboarding());
  await press("[data-entry=scan]");
  expect(heading()).toBe("enter the code");
});

it("picks the first screen from what the phone already has", () => {
  expect(firstStep({ incoming: false, signedIn: false, adding: false })).toBe("welcome");
  expect(firstStep({ incoming: false, signedIn: true, adding: false })).toBe("clouds");
  expect(firstStep({ incoming: true, signedIn: true, adding: false })).toBe("confirm");
  expect(firstStep({ incoming: false, signedIn: true, adding: true })).toBe("welcome");
});

it("a signed-in phone pairs with its only cloud by itself, never saying it is asleep", async () => {
  secrets.set("dusk.account", JSON.stringify({ origin, token, expiresAt: Date.now() + 60_000, account, deviceId: "phone" }));
  const cloud = { id: "home", name: "Home cloud", role: "owner", teamId: null, managed: true, status: "ready", origin: "https://home.example.com", primary: true, power: { state: "asleep" } };
  const onLinked = vi.fn();
  let pairs = 0;
  fetcher.mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/api/cloud/desktop/session")) return response({ ok: true, clouds: [cloud] });
    if (url.endsWith("/api/cloud/desktop/pairing")) { pairs++; return response({ cloudContractVersion: 1, origin: cloud.origin, code: "ABCD-EFGH-JKLM", expiresAt: Date.now() + 60_000 }); }
    return response({ error: "unreachable" }, 503);
  });
  await mount(onboarding({ onLinked }));
  expect(heading()).toBe("pick a cloud");
  expect(host.textContent).not.toMatch(/asleep/i);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(pairs).toBe(1);
  expect(onLinked).toHaveBeenCalledWith(expect.objectContaining({ id: "linked" }), "session", "Home cloud");
});

it("a signed-in account with no cloud is pointed at linking a computer", async () => {
  secrets.set("dusk.account", JSON.stringify({ origin, token, expiresAt: Date.now() + 60_000, account, deviceId: "phone" }));
  fetcher.mockImplementation(async (input) => String(input).endsWith("/api/cloud/desktop/session") ? response({ ok: true, clouds: [] }) : response({}));
  await mount(onboarding());
  expect(heading()).toBe("no cloud yet");
  expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toEqual(expect.arrayContaining(["scan a QR code", "enter a code"]));
});

it("after a QR or code link, offers the account sign-in once, quietly, and remembers not now", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await mount(createElement(SignInOffer));
  expect(host.querySelector("[data-sign-in-offer]")).toBeNull();
  await act(async () => { vi.advanceTimersByTime(3000); });
  await act(async () => {});
  expect(host.querySelector("[data-sign-in-offer]")).not.toBeNull();
  await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "not now")!.click(); });
  expect(host.querySelector("[data-sign-in-offer]")).toBeNull();
  expect(prefs.get(SIGN_IN_OFFER_KEY)).toBe("dismissed");
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => { root.render(createElement(PlatformContext, { value: platform }, createElement(AccountGate, null, createElement(SignInOffer)))); });
  await act(async () => { vi.advanceTimersByTime(3000); });
  await act(async () => {});
  expect(host.querySelector("[data-sign-in-offer]")).toBeNull();
});

it("the sign-in offer opens the sign-in without leaving the app", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await mount(createElement(SignInOffer));
  await act(async () => { vi.advanceTimersByTime(3000); });
  await act(async () => {});
  await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "log in")!.click(); });
  expect(host.querySelector("[role=dialog] h1")?.textContent).toBe("log in to dusk");
});
