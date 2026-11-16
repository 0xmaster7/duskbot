// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { MakingView } from "./MakingStep";

it("once the cloud is ready, Open chat is a live button while the chat opens by itself, never a grey disabled one", () => {
  const html = renderToStaticMarkup(createElement(MakingView, { making: { kind: "ready" }, opening: true, openFailed: false, onOpen: () => {} }));
  const host = document.createElement("div");
  host.innerHTML = html;
  const button = host.querySelector<HTMLButtonElement>("[data-funnel-open-cloud]")!;
  expect(button.textContent).toBe("Open chat");
  expect(button.disabled).toBe(false);
  expect(button.getAttribute("aria-busy")).toBe("true");
});

it("a ready cloud carries its address, and a page that can't be reached isn't one that answers", async () => {
  const { makingFrom, cloudAnswers } = await import("./MakingStep");
  const own = { primary: true, runsOn: "cloud", status: "ready", origin: "https://ada.dusk.test" };
  expect(makingFrom({ clouds: [own] } as never)).toEqual({ kind: "ready", origin: "https://ada.dusk.test" });
  expect(await cloudAnswers("https://ada.dusk.test", (async () => new Response(null)) as typeof fetch)).toBe(true);
  expect(await cloudAnswers("https://ada.dusk.test", (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch)).toBe(false);
});

it("a plan that isn't active never says setup is trying again: it says what to check and opens the plan page", async () => {
  const { makingFrom } = await import("./MakingStep");
  const own = (status: string) => ({ clouds: [{ primary: true, runsOn: "cloud", status, origin: null }] }) as never;
  expect(makingFrom(own("payment_problem"))).toEqual({ kind: "payment" });
  expect(makingFrom(own("ended"))).toEqual({ kind: "payment" });
  expect(makingFrom({ machine: { status: "payment-problem" } } as never)).toEqual({ kind: "payment" });
  expect(makingFrom({ machine: { status: "failed" } } as never)).toEqual({ kind: "failed" });
  let opened = 0;
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(MakingView, { making: { kind: "payment" }, opening: false, openFailed: false, onOpen: () => {}, onPlan: () => { opened++; } }));
  expect(host.textContent).not.toMatch(/trying again/);
  expect(host.textContent).toContain("plan page");
  expect(host.querySelector("[data-funnel-plan-page]")?.textContent).toBe("Open your plan page");
  expect(host.querySelector('[aria-current="step"]'), "no step spins while nothing is being made").toBeNull();
  expect(opened).toBe(0);
});
