import { describe, expect, it, vi } from "vitest";

import type { BoxLoginOptions } from "../box-login-page.ts";
import type { BotRecord } from "../store.ts";
import { createDesktopLogin, type DesktopLoginDeps } from "./desktop-login.ts";
import { DESKTOP_TAKEN } from "./fill-login-turn.ts";

const bot = { id: "b1", name: "Vaultie" } as BotRecord;
const turn = { botId: "b1", threadId: "t1", generation: "g1" };
const input = { engine: async () => null, insertText: async () => {}, press: async () => {}, click: async () => {} };

function desktop(over: Partial<DesktopLoginDeps<typeof turn>> = {}) {
  let guard: BoxLoginOptions["guard"];
  const close = vi.fn();
  const open = vi.fn(async (_url: string, options: BoxLoginOptions = {}) => { guard = options.guard; return { input, url: "https://example.com/login", close }; });
  let holds = false;
  const deps: DesktopLoginDeps<typeof turn> = {
    mounted: () => ({ generation: "g1", botId: "b1" }),
    gate: async () => ({ held: false, helpOpen: false }),
    boxChrome: async () => "http://127.0.0.1:1",
    personHolds: () => holds,
    active: () => true,
    touched: () => {},
    open: open as never,
    ...over,
  };
  const login = createDesktopLogin(deps);
  return { login, open, close, guard: () => guard!(), hold: () => { holds = true; } };
}

describe("fill_login on the bot's VPS desktop", () => {
  it("opens the desktop's Chromium only for this turn's own desktop, once the screen gate lets it", async () => {
    expect(await desktop({ mounted: () => undefined }).login.openDesktopLogin(bot, turn)).toBeNull();
    expect(await desktop({ mounted: () => ({ generation: "older", botId: "b1" }) }).login.openDesktopLogin(bot, turn)).toBeNull();
    expect(await desktop({ boxChrome: async () => false }).login.openDesktopLogin(bot, turn)).toBeNull();
    const held = desktop({ gate: async () => ({ held: true, helpOpen: false, reason: "person" }) });
    expect(await held.login.openDesktopLogin(bot, turn)).toEqual({ refusal: "The person is using your computer right now. Wait for them to hand it back, then call fill_login again." });
    expect(held.open).not.toHaveBeenCalled();
  });

  it("holds the desktop's screen calls back while typing, stops when the person takes control, and closes after", async () => {
    const { login, guard, hold, close } = desktop();
    const opened = await login.openDesktopLogin(bot, turn);
    if (!opened || "refusal" in opened) throw new Error("expected the desktop page");
    expect(login.filling("t1")).toBe(true);
    expect(() => guard()).not.toThrow();
    hold();
    expect(() => guard()).toThrow(DESKTOP_TAKEN);
    opened.finish();
    expect(login.filling("t1")).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it("clears what an unsubmitted fill left on the page when its hold ends", async () => {
    vi.useFakeTimers();
    try {
      const { login, close } = desktop();
      const opened = await login.openDesktopLogin(bot, turn);
      if (!opened || "refusal" in opened) throw new Error("expected the desktop page");
      const clear = vi.fn(async () => {});
      opened.finish({ url: "https://example.com/login", ms: 60_000, clear });
      expect(close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(clear).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
