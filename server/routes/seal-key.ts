// GET /api/seal-key: the key a remote app seals a login, a 1Password token or an API key for (server/sealed-fields.ts),
// signed by this server's long-term identity. Only a public key: never a secret.
import type { CardSealer } from "../card-seal.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createSealKeyRoutes(sealer: CardSealer): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (path !== "/api/seal-key") return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    res.setHeader("cache-control", "no-store");
    return json(res, 200, { sealKey: sealer.publicKey() });
  };
}
