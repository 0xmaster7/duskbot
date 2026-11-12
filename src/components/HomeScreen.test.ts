import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { CloudSetupSteps } from "./CloudSetupSteps";
import { homeDay, homeScreenText } from "./HomeScreen";

beforeEach(() => setLocale("en"));

it("names a team's Cloud on every screen that waits on it, and keeps My Cloud's own words otherwise", () => {
  expect(homeScreenText({ screen: "offline", name: "Acme" }).title).toBe("can't reach Acme right now.");
  expect(homeScreenText({ screen: "offline" }).title).toBe("can't reach my cloud right now.");
  expect(homeScreenText({ screen: "opening", name: "Acme" }).title).toBe("opening Acme…");
  expect(homeScreenText({ screen: "opening" }).title).toBe("opening my cloud…");
  expect(homeScreenText({ screen: "signin", name: "Acme" })).toMatchObject({ title: "sign in to open Acme", action: "sign-in" });
  expect(homeScreenText({ screen: "plan", machine: "stopped", name: "Acme" })).toMatchObject({ title: "Acme isn't running", action: "manage" });
  expect(homeScreenText({ screen: "plan", machine: "stopped" }).title).toBe("my cloud isn't running");
  for (const machine of ["stopped", "payment-problem"] as const) {
    const told = homeScreenText({ screen: "plan", machine, name: "Acme", member: true });
    expect(told, "a team's User asks its owner, and has nothing to press").toMatchObject({ title: "Acme isn't running", body: "ask its owner to start it again. its files are kept for a while.", action: null });
  }
  expect(homeScreenText({ screen: "plan", machine: "stopped", name: "Acme" }).body, "whoever pays is told how").toContain("subscribe again on your plan page");
  expect(homeScreenText({ screen: "plan", machine: "payment-problem", name: "Acme" }).action).toBe("manage");
  expect(homeScreenText({ screen: "plan", machine: "failed", name: "Acme", member: true }).body, "a failed machine isn't anyone's plan").not.toContain("owner");
  expect(homeScreenText({ screen: "waking", name: "Acme" }).title, "only My Cloud is woken").toBe("waking my cloud…");
  expect(homeScreenText(null).title).toBe("opening my cloud…");
  expect(homeScreenText({ screen: "moving" }).title).toBe("moving to my cloud… almost done");
  expect(homeScreenText({ screen: "moving", name: "Garage server" })).toMatchObject({ title: "moving to Garage server… almost done", action: null, busy: true });
});

it("while the Admin sets My Cloud up, the screen says so plainly, with its step, and never asks the person to do anything", () => {
  const setup = homeScreenText({ screen: "setup", step: "storage" });
  expect(setup).toEqual({ title: "setting up my cloud…", body: "this takes about a minute. it opens by itself when it's ready.", reason: null, action: null, busy: true });
  expect(homeScreenText({ screen: "setup", name: "Acme" }).title).toBe("setting up Acme…");
  expect(homeScreenText({ screen: "setup", step: "starting", slow: true }).body).toMatch(/taking longer than usual/);
  const steps = renderToStaticMarkup(createElement(CloudSetupSteps, { step: "checking" }));
  expect(steps).toContain('data-cloud-setup="checking"');
  expect(steps).toMatch(/aria-current="step"[^>]*>checking it&#x27;s ready</);
  for (const words of Object.values(setup)) expect(String(words)).not.toMatch(/Server menu|choose it again|DNS|resolv|ERR_/i);
});

it("a Cloud that isn't running says what it is in plain words with its one action; one that doesn't answer says Try again, with no endless spinner", () => {
  const now = new Date(2026, 9, 30, 12).getTime(), day = new Date(2026, 10, 1, 9).getTime();
  expect(homeScreenText({ screen: "ended", name: "My Cloud", deleteAt: day }, now))
    .toEqual({ title: "My Cloud has ended.", body: "its files are deleted on November 1.", reason: null, action: "buy", busy: false });
  expect(homeScreenText({ screen: "ended" }).title).toBe("this cloud has ended.");
  expect(homeScreenText({ screen: "ended", name: "Old" }).body, "its files' day only when the Admin names it").toBeNull();
  expect(homeScreenText({ screen: "checkout", name: "Client B" })).toEqual({ title: "the checkout for Client B wasn't finished.", body: null, reason: null, action: "continue", busy: false });
  expect(homeScreenText({ screen: "checkout" }).title).toBe("this checkout wasn't finished.");
  expect(homeScreenText({ screen: "payment", name: "Client B" }))
    .toEqual({ title: "the payment for Client B didn't go through.", body: "update your card to keep using it.", reason: null, action: "card", busy: false });
  expect(homeScreenText({ screen: "offline", name: "Acme" })).toMatchObject({ title: "can't reach Acme right now.", action: "retry", busy: false });
  expect(homeScreenText({ screen: "offline" })).toMatchObject({ title: "can't reach my cloud right now.", action: "retry", busy: false });
  expect(homeDay(new Date(2027, 0, 5).getTime(), now), "another year is named").toBe("January 5, 2027");
  for (const screen of ["ended", "checkout", "payment"] as const) {
    for (const words of Object.values(homeScreenText({ screen, name: "Client B", deleteAt: day }, now))) expect(String(words)).not.toMatch(/—|\bVM\b|engine|ctx|server/i);
  }
});
