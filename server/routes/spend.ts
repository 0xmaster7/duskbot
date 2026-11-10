import type { RequestAuth } from "../request-auth.ts";
import type { ForecastRoutine, Spend } from "../spend.ts";
import { validCap } from "../spend.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface SpendRouteDeps {
  spend: Spend;
  botName(id: string): string | undefined;
  /** A routine this viewer may see, or undefined. */
  routine(auth: RequestAuth, id: string): (ForecastRoutine & { name: string }) | undefined;
  mayChangeCaps(auth: RequestAuth): boolean;
}

const FORECAST = /^\/api\/routines\/([\w-]{1,200})\/forecast$/;

export function createSpendRoutes(deps: SpendRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method === "GET" && path === "/api/usage/battery") {
      res.setHeader("cache-control", "no-store");
      return json(res, 200, deps.spend.battery({ bot: deps.botName, routine: (id) => deps.routine(auth, id) }));
    }
    if (method === "PUT" && path === "/api/usage/caps") {
      if (!deps.mayChangeCaps(auth)) return json(res, 403, { error: "forbidden" });
      let body: unknown;
      try { body = await readBody(req, 4_096); } catch { return json(res, 400, { error: "expected a small JSON body" }); }
      const cap = validCap(body);
      if (!cap) return json(res, 400, { error: "kind (bot or routine), id and usd (a positive amount, or null) are required" });
      if (cap.kind === "routine" && !deps.routine(auth, cap.id)) return json(res, 404, { error: "no such routine" });
      if (cap.kind === "bot" && deps.botName(cap.id) === undefined) return json(res, 404, { error: "no such bot" });
      deps.spend.setCap(cap);
      return json(res, 200, deps.spend.caps());
    }
    const forecast = method === "GET" ? FORECAST.exec(path) : null;
    if (forecast) {
      const routine = deps.routine(auth, forecast[1]!);
      if (!routine) return json(res, 404, { error: "no such routine" });
      res.setHeader("cache-control", "no-store");
      return json(res, 200, deps.spend.forecast(routine));
    }
    return PASS;
  };
}
