// Turn it on or Not now on the suggestion to keep an eye on the person's day (server/host/proactive.ts). Only the owner
// or an admin answers, and only the card the suggestion posted.
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface WatchSuggestionRouteDeps {
  answer(threadId: string, messageId: string, answer: "on" | "notNow", auth: RequestAuth): "kept" | "refused" | "unknown" | "unavailable";
}

const ID = /^[\w-]{1,128}$/;

export function createWatchSuggestionRoutes(deps: WatchSuggestionRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/watch/suggestion" || method !== "POST") return PASS;
    const body = await readBody(req, 2048);
    const threadId = typeof body?.threadId === "string" ? body.threadId : "";
    const messageId = typeof body?.messageId === "string" ? body.messageId : "";
    const answer = body?.answer === "on" || body?.answer === "notNow" ? body.answer : null;
    if (!ID.test(threadId) || !ID.test(messageId) || !answer) return json(res, 400, { error: "threadId, messageId and answer are required" });
    const outcome = deps.answer(threadId, messageId, answer, auth);
    if (outcome === "refused") return json(res, 403, { error: "Only the owner can answer this." });
    if (outcome === "unknown") return json(res, 404, { error: "There is no such suggestion." });
    if (outcome === "unavailable") return json(res, 409, { error: "This can't be turned on here right now." });
    return json(res, 200, { ok: true });
  };
}
