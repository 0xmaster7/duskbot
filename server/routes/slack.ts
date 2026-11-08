import { z } from "zod";

import type { SlackBotStatus, SlackProvisionResponse, SlackWorkspaceStatus } from "../../shared/slack.ts";
import { SlackApiError } from "../slack/api.ts";
import { SlackSecretsUnavailable } from "../slack/secrets.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

export interface SlackRoutesDeps {
  workspace(): SlackWorkspaceStatus;
  connect(accessToken: string, refreshToken: string): Promise<SlackWorkspaceStatus>;
  disconnect(): SlackWorkspaceStatus;
  /** the bot exists on this server and the caller may change it; null otherwise */
  bot(botId: string): { id: string; name: string } | null;
  botStatus(botId: string): SlackBotStatus;
  provision(botId: string): Promise<SlackProvisionResponse>;
  exchange(code: string, state: string): Promise<SlackBotStatus>;
  setAppToken(botId: string, token: string): Promise<SlackBotStatus>;
  remove(botId: string): Promise<SlackBotStatus>;
  log?: (line: string) => void;
}

const connectBody = z.strictObject({
  accessToken: z.string().trim().min(10).max(4096),
  refreshToken: z.string().trim().min(10).max(4096),
});
const oauthBody = z.strictObject({
  code: z.string().regex(/^[A-Za-z0-9._-]{8,256}$/),
  state: z.string().regex(/^[0-9a-f]{64}$/),
});
const appTokenBody = z.strictObject({ token: z.string().trim().min(10).max(400) });
const BOT = /^\/api\/slack\/bots\/([\w-]{1,128})(?:\/(provision|app-token))?$/;
const CONNECT_ERROR = "Paste both tokens from Your App Configuration Tokens.";
const OAUTH_ERROR = "This Slack link is not valid.";
const APP_TOKEN_ERROR = "Paste the app-level token.";

const errorAnswers = new Map<string, readonly [number, string]>([
  ["needs_reconnect", [409, "Connect the Slack workspace again in Settings, Connections."]],
  ["bad_state", [400, "This Slack link was already used or is not valid. Click Add to Slack again."]],
  ["expired_state", [400, "This Slack link expired. Click Add to Slack again."]],
  ["bad_code", [400, OAUTH_ERROR]],
  ...["wrong_app", "wrong_team"].map((code): [string, readonly [number, string]] =>
    [code, [400, "That Slack approval was for a different app or workspace."]]),
  ["already_installed", [409, "This bot is already in Slack."]],
  ["not_installed", [409, "Add the bot to Slack first."]],
  ["bad_app_token", [400, "That isn't an app-level token. It starts with xapp-."]],
  ...["invalid_auth", "not_authed", "token_revoked", "token_expired", "invalid_refresh_token", "account_inactive"]
    .map((code): [string, readonly [number, string]] => [code, [422, "Slack didn't accept that token."]]),
  ["invalid_code", [400, "Slack didn't accept that approval. Click Add to Slack again."]],
  ["bad_redirect_uri", [400, "Slack's redirect address doesn't match this app."]],
  ["ratelimited", [429, "Slack is busy. Try again in a minute."]],
  ...["network", "server_error", "bad_response"].map((code): [string, readonly [number, string]] =>
    [code, [502, "Slack couldn't be reached. Try again."]]),
  ...["managed_app_limit_reached", "app_limit_reached", "too_many_apps"].map((code): [string, readonly [number, string]] =>
    [code, [409, "This Slack workspace has no room for another app. Free workspaces allow 10."]]),
]);

export function slackErrorAnswer(error: unknown): { status: number; error: string; code: string } {
  if (error instanceof SlackSecretsUnavailable) {
    return { status: 503, error: "Slack settings are still loading. Try again in a moment.", code: "unavailable" };
  }
  if (error instanceof SlackApiError) {
    const code = /^[a-z_]{1,64}$/.test(error.code) ? error.code : "unknown";
    const [status, message] = errorAnswers.get(code) ?? [422, `Slack refused that: ${code}`];
    return { status, error: message, code };
  }
  return { status: 500, error: "Something went wrong talking to Slack.", code: "internal" };
}

async function parseBody<T>(ctx: RouteContext, schema: z.ZodType<T>, message: string): Promise<{ data: T } | null> {
  const contentType = String(ctx.req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (contentType !== "application/json") {
    ctx.json(ctx.res, 415, { error: "content-type must be application/json" });
    return null;
  }
  let body: unknown;
  try {
    body = await ctx.readBody(ctx.req, 16_384);
  } catch (error) {
    const tooLarge = error instanceof Error && "status" in error && error.status === 413;
    ctx.json(ctx.res, tooLarge ? 413 : 400, { error: tooLarge ? "body too large" : message });
    return null;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    ctx.json(ctx.res, 400, { error: message });
    return null;
  }
  return { data: parsed.data };
}

export function createSlackRoutes(deps: SlackRoutesDeps): RouteHandler {
  return async (ctx) => {
    const { res, path, method, auth, json } = ctx;
    if (path !== "/api/slack" && !path.startsWith("/api/slack/")) return PASS;
    res.setHeader("Cache-Control", "no-store");
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Only the owner or an admin can manage Slack." });
    const wrongMethod = () => json(res, 405, { error: "method not allowed" });
    try {
      if (path === "/api/slack/workspace") {
        if (method === "GET") return json(res, 200, deps.workspace());
        if (method === "DELETE") return json(res, 200, deps.disconnect());
        if (method !== "PUT") return wrongMethod();
        const body = await parseBody(ctx, connectBody, CONNECT_ERROR);
        if (!body) return;
        return json(res, 200, await deps.connect(body.data.accessToken, body.data.refreshToken));
      }
      if (path === "/api/slack/oauth") {
        if (method !== "POST") return wrongMethod();
        const body = await parseBody(ctx, oauthBody, OAUTH_ERROR);
        if (!body) return;
        return json(res, 200, { status: await deps.exchange(body.data.code, body.data.state) });
      }
      const match = BOT.exec(path);
      if (!match) return json(res, 404, { error: "not found" });
      const botId = match[1]!;
      const action = match[2];
      if (action ? method !== "POST" : method !== "GET" && method !== "DELETE") return wrongMethod();
      if (!deps.bot(botId)) return json(res, 404, { error: "No such bot." });
      if (action === "provision") return json(res, 200, await deps.provision(botId));
      if (action === "app-token") {
        const body = await parseBody(ctx, appTokenBody, APP_TOKEN_ERROR);
        if (!body) return;
        return json(res, 200, { status: await deps.setAppToken(botId, body.data.token) });
      }
      return json(res, 200, method === "GET" ? deps.botStatus(botId) : await deps.remove(botId));
    } catch (error) {
      const answer = slackErrorAnswer(error);
      if (answer.status === 500) deps.log?.("Slack management request failed.");
      return json(res, answer.status, { error: answer.error, code: answer.code });
    }
  };
}
