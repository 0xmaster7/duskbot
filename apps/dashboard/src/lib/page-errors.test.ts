import { describe, expect, it, vi } from "vitest";
import { reportPageErrors } from "./page-errors";

describe("page error reports", () => {
  it("sends an uncaught error's type, message and stack to the service, five at most", () => {
    const listeners: Record<string, (event: unknown) => void> = {};
    const send = vi.fn(async () => new Response(null, { status: 204 }));
    reportPageErrors({ addEventListener: (name: string, fn: (event: unknown) => void) => { listeners[name] = fn; } } as never, send as never, () => "/billing/plan");
    const error = new TypeError("x is undefined");
    for (let i = 0; i < 7; i++) listeners.error!({ error });
    listeners.unhandledrejection!({ reason: "late" });
    expect(send).toHaveBeenCalledTimes(5);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/v1/client-error");
    expect(JSON.parse(init.body as string)).toMatchObject({ type: "TypeError", message: "x is undefined", page: "/billing" });
  });
});
