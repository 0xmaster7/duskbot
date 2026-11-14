import { afterEach, describe, expect, it, vi } from "vitest";
import { aiSendAllowed, installAiConsentGate } from "./ai-consent-gate";

let remove: (() => void) | null = null;
afterEach(() => { remove?.(); remove = null; });

describe("ai consent gate", () => {
  it("lets everything through where no gate is installed (the desktop)", () => {
    expect(aiSendAllowed()).toBe(true);
  });

  it("holds a send back and asks, handing over the send to retry", () => {
    let allowed = false;
    const ask = vi.fn();
    remove = installAiConsentGate({ allowed: () => allowed, ask });
    const retry = () => {};
    expect(aiSendAllowed(retry)).toBe(false);
    expect(ask).toHaveBeenCalledWith(retry);
    allowed = true;
    expect(aiSendAllowed(retry)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
