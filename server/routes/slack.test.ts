import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SlackBotStatus, SlackProvisionResponse, SlackWorkspaceStatus } from "../../shared/slack.ts";
import { json, readBody } from "../harness/http.ts";
import { SlackApiError } from "../slack/api.ts";
import { SlackSecretsUnavailable } from "../slack/secrets.ts";
import { createSlackRoutes, slackErrorAnswer, type SlackRoutesDeps } from "./slack.ts";
import { PASS } from "./table.ts";

const workspace: SlackWorkspaceStatus = { version: 1, state: "connected", teamId: "T1", apps: 1, ready: true };
const disconnected: SlackWorkspaceStatus = { version: 1, state: "not_connected", apps: 1, ready: true };
const status: SlackBotStatus = { version: 1, botId: "bot-1", state: "online", appId: "A1" };
const removed: SlackBotStatus = { version: 1, botId: "bot-1", state: "not_linked" };
const provisioned: SlackProvisionResponse = { status: { ...status, state: "provisioned" }, authorizeUrl: "https://slack.com/oauth/v2/authorize" };
const pair = { accessToken: "test-access-token", refreshToken: "test-refresh-token" };
const oauth = { code: "test.code-123", state: "a".repeat(64) };
const appToken = { token: "xapp-test-app-token" };
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
});

function stubDeps() {
  return {
    workspace: vi.fn(() => workspace),
    connect: vi.fn(async (_access: string, _refresh: string) => workspace),
    disconnect: vi.fn(() => disconnected),
    bot: vi.fn((id: string) => id === "bot-1" ? { id, name: "Scout" } : null),
    botStatus: vi.fn((_id: string) => status),
    provision: vi.fn(async (_id: string) => provisioned),
    exchange: vi.fn(async (_code: string, _state: string) => status),
    setAppToken: vi.fn(async (_id: string, _token: string) => status),
    remove: vi.fn(async (_id: string) => removed),
    log: vi.fn(),
  } satisfies SlackRoutesDeps;
}

async function serve(deps: SlackRoutesDeps = stubDeps(), admin = true) {
  const route = createSlackRoutes(deps);
  const read = vi.fn(readBody);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const result = await route({
      req, res, url, path: url.pathname, method: req.method ?? "GET",
      auth: { kind: "loopback", scopes: admin ? ["admin"] : ["client"] }, json, readBody: read,
    });
    if (result === PASS) json(res, 418, { pass: true });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (path: string, method = "GET", body?: unknown, contentType: string | null = "application/json") => {
    const response = await fetch(`${base}${path}`, {
      method, headers: contentType === null ? {} : { "content-type": contentType },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const answer = await response.json();
    if (path === "/api/slack" || path.startsWith("/api/slack/")) expect(response.headers.get("cache-control")).toBe("no-store");
    return { status: response.status, body: answer, headers: response.headers };
  };
  return { base, request, read };
}

describe("Slack routes", () => {
  it.each(["/api/email", "/api/slackish", "/api/internal/slack/post", "/other"])("passes unrelated path %s", async (path) => {
    const deps = stubDeps();
    const { request } = await serve(deps, false);
    const answer = await request(path);
    expect(answer.status).toBe(418);
    expect(answer.body).toEqual({ pass: true });
    expect(answer.headers.has("cache-control")).toBe(false);
    for (const dep of Object.values(deps)) expect(dep).not.toHaveBeenCalled();
  });

  it.each(["/api/slack/workspace", "/api/slack/oauth", "/api/slack/bots/bot-1", "/api/slack/bots/bot-1/provision", "/api/slack/bots/bot-1/app-token", "/api/slack/unknown"])("refuses a non-admin at %s", async (path) => {
    const deps = stubDeps();
    const { request, read } = await serve(deps, false);
    expect(await request(path, "POST", {})).toMatchObject({
      status: 403, body: { error: "Only the owner or an admin can manage Slack." },
    });
    expect(read).not.toHaveBeenCalled();
    for (const dep of Object.values(deps)) expect(dep).not.toHaveBeenCalled();
  });

  it("returns each workspace result and trims the configuration pair", async () => {
    const deps = stubDeps();
    const { request, read } = await serve(deps);
    expect(await request("/api/slack/workspace")).toMatchObject({ status: 200, body: workspace });
    expect(await request("/api/slack/workspace", "PUT", {
      accessToken: `  ${pair.accessToken}\n`, refreshToken: `\t${pair.refreshToken}  `,
    }, "Application/JSON; charset=utf-8")).toMatchObject({ status: 200, body: workspace });
    expect(deps.connect).toHaveBeenCalledExactlyOnceWith(pair.accessToken, pair.refreshToken);
    expect(read).toHaveBeenCalledWith(expect.anything(), 16_384);
    expect(await request("/api/slack/workspace", "DELETE")).toMatchObject({ status: 200, body: disconnected });
    expect(deps.workspace).toHaveBeenCalledOnce();
    expect(deps.disconnect).toHaveBeenCalledOnce();
  });

  it("returns each bot result and checks bot access", async () => {
    const deps = stubDeps();
    const { request } = await serve(deps);
    expect(await request("/api/slack/bots/bot-1")).toMatchObject({ status: 200, body: status });
    expect(await request("/api/slack/bots/bot-1/provision", "POST")).toMatchObject({ status: 200, body: provisioned });
    expect(await request("/api/slack/bots/bot-1/app-token", "POST", { token: ` \t${appToken.token}\n` }))
      .toMatchObject({ status: 200, body: { status } });
    expect(await request("/api/slack/bots/bot-1", "DELETE")).toMatchObject({ status: 200, body: removed });
    expect(deps.bot).toHaveBeenCalledTimes(4);
    expect(deps.bot.mock.calls.every(([id]) => id === "bot-1")).toBe(true);
    expect(deps.botStatus).toHaveBeenCalledExactlyOnceWith("bot-1");
    expect(deps.provision).toHaveBeenCalledExactlyOnceWith("bot-1");
    expect(deps.setAppToken).toHaveBeenCalledExactlyOnceWith("bot-1", appToken.token);
    expect(deps.remove).toHaveBeenCalledExactlyOnceWith("bot-1");
  });

  it("exchanges OAuth credentials and wraps the resulting status", async () => {
    const deps = stubDeps();
    const { request } = await serve(deps);
    expect(await request("/api/slack/oauth", "POST", oauth)).toMatchObject({ status: 200, body: { status } });
    expect(deps.exchange).toHaveBeenCalledExactlyOnceWith(oauth.code, oauth.state);
    expect(deps.bot).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/slack/workspace", "POST"], ["/api/slack/workspace", "PATCH"],
    ["/api/slack/oauth", "GET"], ["/api/slack/oauth", "PUT"],
    ["/api/slack/bots/bot-1", "POST"], ["/api/slack/bots/bot-1", "PUT"],
    ["/api/slack/bots/bot-1/provision", "DELETE"], ["/api/slack/bots/bot-1/app-token", "PUT"],
  ])("refuses wrong method at %s with %s", async (path, method) => {
    const deps = stubDeps();
    const { request, read } = await serve(deps);
    expect(await request(path, method)).toMatchObject({ status: 405, body: { error: "method not allowed" } });
    expect(read).not.toHaveBeenCalled();
    for (const dep of Object.values(deps)) expect(dep).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/slack/workspace", "PUT", pair],
    ["/api/slack/oauth", "POST", oauth],
    ["/api/slack/bots/bot-1/app-token", "POST", appToken],
  ])("requires a JSON content type at %s", async (path, method, body) => {
    const deps = stubDeps();
    const { request, read } = await serve(deps);
    for (const contentType of [null, "text/plain", "application/jsonp", "application/json-invalid"]) {
      expect(await request(path, method, body, contentType)).toMatchObject({ status: 415 });
    }
    expect(read).not.toHaveBeenCalled();
    expect(deps.connect).not.toHaveBeenCalled();
    expect(deps.exchange).not.toHaveBeenCalled();
    expect(deps.setAppToken).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", ""], ["DELETE", ""], ["POST", "/provision"], ["POST", "/app-token"],
  ])("refuses unknown bots for %s %s", async (method, suffix) => {
    const deps = stubDeps();
    const { request } = await serve(deps);
    expect(await request(`/api/slack/bots/missing${suffix}`, method)).toMatchObject({ status: 404, body: { error: "No such bot." } });
    expect(deps.bot).toHaveBeenCalledExactlyOnceWith("missing");
    expect(deps.botStatus).not.toHaveBeenCalled();
    expect(deps.provision).not.toHaveBeenCalled();
    expect(deps.setAppToken).not.toHaveBeenCalled();
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it.each(["/api/slack", "/api/slack/", "/api/slack/unknown", "/api/slack/workspace/", "/api/slack/bots", "/api/slack/bots/bot-1/extra", "/api/slack/bots/a.b", `/api/slack/bots/${"a".repeat(129)}`])("answers unknown Slack path %s", async (path) => {
    const { request } = await serve();
    expect(await request(path)).toMatchObject({ status: 404, body: { error: "not found" } });
  });

  it.each([
    ["workspace", [{}, null, [], { ...pair, extra: true }, { ...pair, accessToken: 10 },
      { ...pair, accessToken: " ".repeat(10) }, { ...pair, accessToken: "a".repeat(9) },
      { ...pair, refreshToken: "a".repeat(9) }, { ...pair, accessToken: "a".repeat(4097) },
      { ...pair, refreshToken: "a".repeat(4097) }], "Paste both tokens from Your App Configuration Tokens."],
    ["oauth", [{}, null, { ...oauth, extra: true }, { ...oauth, code: 12 }, { ...oauth, code: "a".repeat(7) },
      { ...oauth, code: "a".repeat(257) }, { ...oauth, code: "invalid/code" }, { ...oauth, code: ` ${oauth.code}` },
      { ...oauth, state: "A".repeat(64) }, { ...oauth, state: "g".repeat(64) }, { ...oauth, state: "a".repeat(63) },
      { ...oauth, state: "a".repeat(65) }], "This Slack link is not valid."],
    ["bots/bot-1/app-token", [{}, null, { ...appToken, extra: true }, { token: 12 }, { token: " ".repeat(10) },
      { token: "a".repeat(9) }, { token: "a".repeat(401) }], "Paste the app-level token."],
  ])("strictly validates %s bodies", async (path, bodies, error) => {
    const deps = stubDeps();
    const { request } = await serve(deps);
    for (const body of bodies) {
      expect(await request(`/api/slack/${path}`, path === "workspace" ? "PUT" : "POST", body))
        .toMatchObject({ status: 400, body: { error } });
    }
    expect(deps.connect).not.toHaveBeenCalled();
    expect(deps.exchange).not.toHaveBeenCalled();
    expect(deps.setAppToken).not.toHaveBeenCalled();
  });

  it("accepts input length boundaries", async () => {
    const { request } = await serve();
    for (const length of [10, 4096]) {
      expect((await request("/api/slack/workspace", "PUT", { accessToken: "a".repeat(length), refreshToken: "r".repeat(length) })).status).toBe(200);
    }
    for (const length of [8, 256]) expect((await request("/api/slack/oauth", "POST", { ...oauth, code: "a".repeat(length) })).status).toBe(200);
    for (const length of [10, 400]) expect((await request("/api/slack/bots/bot-1/app-token", "POST", { token: "a".repeat(length) })).status).toBe(200);
  });

  it("bounds body reads in bytes and handles malformed JSON without echoing it", async () => {
    const deps = stubDeps();
    const { base } = await serve(deps);
    for (const [body, expectedStatus] of [["{" + pair.accessToken, 400], [JSON.stringify({ token: "é".repeat(8192) }), 413]] as const) {
      const response = await fetch(`${base}/api/slack/bots/bot-1/app-token`, { method: "POST", headers: { "content-type": "application/json" }, body });
      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).not.toContain(pair.accessToken);
    }
    expect(deps.setAppToken).not.toHaveBeenCalled();
  });

  it("never exposes thrown error text or credentials in a response or log", async () => {
    const deps = stubDeps();
    deps.connect.mockRejectedValue(new Error(`private failure: ${pair.accessToken}`));
    const { request } = await serve(deps);
    const answer = await request("/api/slack/workspace", "PUT", pair);
    expect(answer).toMatchObject({ status: 500, body: { error: "Something went wrong talking to Slack.", code: "internal" } });
    expect(JSON.stringify(answer.body)).not.toContain(pair.accessToken);
    expect(JSON.stringify(answer.body)).not.toContain("private failure");
    expect(deps.log).toHaveBeenCalledExactlyOnceWith("Slack management request failed.");
    expect(JSON.stringify(deps.log.mock.calls)).not.toContain(pair.accessToken);
  });

  it.each([
    [new SlackApiError("needs_reconnect"), 409, "Connect the Slack workspace again in Settings, Connections.", "needs_reconnect"],
    [new SlackApiError("ratelimited"), 429, "Slack is busy. Try again in a minute.", "ratelimited"],
    [new SlackApiError("network"), 502, "Slack couldn't be reached. Try again.", "network"],
    [new SlackSecretsUnavailable(), 503, "Slack settings are still loading. Try again in a moment.", "unavailable"],
    [new SlackApiError("unknown_reason"), 422, "Slack refused that: unknown_reason", "unknown_reason"],
    [new SlackApiError("internal"), 422, "Slack refused that: internal", "internal"],
    [new SlackApiError(pair.accessToken), 422, "Slack refused that: unknown", "unknown"],
  ])("returns a safe mapped dependency error %#", async (error, expectedStatus, message, code) => {
    const deps = stubDeps();
    deps.provision.mockRejectedValue(error);
    const { request } = await serve(deps);
    const answer = await request("/api/slack/bots/bot-1/provision", "POST");
    expect(answer).toMatchObject({ status: expectedStatus, body: { error: message, code } });
    expect(JSON.stringify(answer.body)).not.toContain(pair.accessToken);
    expect(deps.log).not.toHaveBeenCalled();
  });

  it("maps synchronous dependency errors", async () => {
    const deps = stubDeps();
    deps.workspace.mockImplementation(() => { throw new SlackSecretsUnavailable(); });
    const { request } = await serve(deps);
    expect(await request("/api/slack/workspace")).toMatchObject({ status: 503, body: { code: "unavailable" } });
  });
});

describe("slackErrorAnswer", () => {
  it.each([
    [["bad_state"], 400, "This Slack link was already used or is not valid. Click Add to Slack again."],
    [["expired_state"], 400, "This Slack link expired. Click Add to Slack again."],
    [["bad_code"], 400, "This Slack link is not valid."],
    [["wrong_app", "wrong_team"], 400, "That Slack approval was for a different app or workspace."],
    [["already_installed"], 409, "This bot is already in Slack."],
    [["not_installed"], 409, "Add the bot to Slack first."],
    [["bad_app_token"], 400, "That isn't an app-level token. It starts with xapp-."],
    [["invalid_auth", "not_authed", "token_revoked", "token_expired", "invalid_refresh_token", "account_inactive"], 422, "Slack didn't accept that token."],
    [["invalid_code"], 400, "Slack didn't accept that approval. Click Add to Slack again."],
    [["bad_redirect_uri"], 400, "Slack's redirect address doesn't match this app."],
    [["network", "server_error", "bad_response"], 502, "Slack couldn't be reached. Try again."],
    [["managed_app_limit_reached", "app_limit_reached", "too_many_apps"], 409, "This Slack workspace has no room for another app. Free workspaces allow 10."],
  ])("maps code group %#", (codes, expectedStatus, error) => {
    for (const code of codes) expect(slackErrorAnswer(new SlackApiError(code))).toEqual({ status: expectedStatus, error, code });
  });

  it.each(["", "INVALID", "bad-code", "a".repeat(65), pair.accessToken])("sanitizes unsafe codes %#", (code) => {
    expect(slackErrorAnswer(new SlackApiError(code))).toEqual({ status: 422, error: "Slack refused that: unknown", code: "unknown" });
  });

  it.each([new Error("private error"), null, "private error", { code: "network" }])("maps unrecognized failures %#", (error) => {
    expect(slackErrorAnswer(error)).toEqual({ status: 500, error: "Something went wrong talking to Slack.", code: "internal" });
  });
});
