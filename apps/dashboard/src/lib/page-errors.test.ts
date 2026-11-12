import { describe, expect, it, vi } from "vitest";
import { reportPageErrors } from "./page-errors";

describe("page error reports", () => {
  function setup(path: string) {
    const listeners: Record<string, (event: unknown) => void> = {};
    const send = vi.fn(async () => new Response(null, { status: 204 }));
    reportPageErrors({ addEventListener: (name: string, fn: (event: unknown) => void) => { listeners[name] = fn; } } as never, send as never, () => path,
      () => "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    return { listeners, send };
  }
  it("sends an uncaught error once per load, with its path, build and os family", () => {
    const { listeners, send } = setup("/dashboard/billing");
    const error = new TypeError("x is undefined");
    for (let i = 0; i < 7; i++) listeners.error!({ error });
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/v1/errors");
    expect(JSON.parse(init.body as string)).toMatchObject({ source: "web", type: "TypeError", message: "x is undefined", path: "/dashboard/billing", os: "macos" });
  });
  it("sends five different errors at most, and marks the admin page", () => {
    const { listeners, send } = setup("/admin/health");
    for (let i = 0; i < 7; i++) listeners.error!({ error: new Error(`e${i}`) });
    listeners.unhandledrejection!({ reason: "late" });
    expect(send).toHaveBeenCalledTimes(5);
    expect(JSON.parse((send.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).source).toBe("admin");
  });
});
