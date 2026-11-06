import { describe, expect, it, vi } from "vitest";

import { composioConnectServer, createComposioConnectRoutes, readAppConnection } from "./composio-connect.ts";
import { PASS } from "./routes/table.ts";

const text = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

describe("Composio Connect's manage-connections answer", () => {
  it("reads an active app, a started one with its link, and a refusal", () => {
    expect(readAppConnection(text({ successful: true, data: { message: "ok", results: { gmail: { status: "ACTIVE" } } } }), "gmail")).toEqual({ status: "connected" });
    expect(readAppConnection(text({ successful: true, data: { results: { notion: { status: "initiated", redirect_url: "https://connect.composio.dev/link/ln_1" } } } }), "notion"))
      .toEqual({ status: "started", url: "https://connect.composio.dev/link/ln_1" });
    expect(readAppConnection(text({ successful: false, error: "Toolkit nope not found", data: { message: "failed", results: {} } }), "nope"))
      .toEqual({ status: "failed", message: "failed" });
  });

  it("finds the link in plain text or in fields the docs do not name", () => {
    expect(readAppConnection({ content: [{ type: "text", text: "Connect Slack here: https://connect.composio.dev/link/ln_2." }] }, "slack"))
      .toEqual({ status: "started", url: "https://connect.composio.dev/link/ln_2." });
    expect(readAppConnection(text({ data: { results: { SLACK: { connection: { link: "https://connect.composio.dev/link/ln_3" } } } } }), "slack"))
      .toEqual({ status: "started", url: "https://connect.composio.dev/link/ln_3" });
  });
});

describe("the Composio Connect routes", () => {
  const server = { type: "http", url: "https://connect.composio.dev/mcp", headers: {}, enabled: true };
  const call = async (handler: ReturnType<typeof createComposioConnectRoutes>, method: string, path: string) => {
    const sent: { status?: number; body?: unknown } = {};
    const out = await handler({ method, path, res: {}, json: (_res: unknown, status: number, body: unknown) => { sent.status = status; sent.body = body; } } as never);
    return out === PASS ? PASS : sent;
  };

  it("finds the server by its address, whatever it is called", () => {
    expect(composioConnectServer({ mine: server, other: { type: "http", url: "https://example.com/mcp", headers: {}, enabled: true } })?.name).toBe("mine");
    expect(composioConnectServer({})).toBeNull();
  });

  it("connects an app through the signed-in server, and asks for the sign-in first", async () => {
    const manage = vi.fn(async () => ({ status: "started" as const, url: "https://connect.composio.dev/link/ln_4" }));
    let signedIn = false;
    const handler = createComposioConnectRoutes({
      servers: () => ({ "composio-connect": server }), signedIn: () => signedIn,
      withToken: async (_name, stored) => ({ ...stored, headers: { Authorization: "Bearer t" } }), refusal: (slug) => slug === "blocked" ? "Your organization turned this app off." : null, manage,
    });
    expect(await call(handler, "GET", "/api/connectors/composio-connect")).toEqual({ status: 200, body: { added: true, name: "composio-connect", signedIn: false, enabled: true } });
    expect(await call(handler, "POST", "/api/connectors/composio-connect/apps/notion")).toMatchObject({ status: 409, body: { code: "composio_connect_signed_out" } });
    signedIn = true;
    expect(await call(handler, "POST", "/api/connectors/composio-connect/apps/notion")).toEqual({ status: 200, body: { status: "started", url: "https://connect.composio.dev/link/ln_4" } });
    expect(manage).toHaveBeenCalledWith(expect.objectContaining({ headers: { Authorization: "Bearer t" } }), "notion");
    expect(await call(handler, "POST", "/api/connectors/composio-connect/apps/blocked")).toMatchObject({ status: 403 });
    expect(await call(handler, "GET", "/api/connectors/other")).toBe(PASS);
  });
});
