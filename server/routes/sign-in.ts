import type { CheckAnswer, SignInCard, SignInRefusal } from "../host/sign-in-requests.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

/** Only dispatch inside the internal capability gate, with its guarded body
 * reader. The global route table must never register this endpoint. */
export function createInternalSignInRoutes(deps: {
  readBody(): ReturnType<RouteContext["readBody"]>;
  /** A check also carries the bot's own words on the other routes it tried; it may end without a card. */
  request(site: unknown, reason: unknown, check?: { otherRoutes: unknown }): SignInCard | CheckAnswer | SignInRefusal | Promise<SignInCard | CheckAnswer | SignInRefusal>;
}): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (method !== "POST" || path !== "/api/internal/request-sign-in") return PASS;
    const body = await deps.readBody();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(res, 400, { error: "request body must be a JSON object" });
    }
    const result = body.check === true ? await deps.request(body.site, body.reason, { otherRoutes: body.otherRoutes }) : await deps.request(body.site, body.reason);
    if ("error" in result) return json(res, result.status, { error: result.error });
    return json(res, "messageId" in result && !("reused" in result) ? 201 : 200, result);
  };
}
