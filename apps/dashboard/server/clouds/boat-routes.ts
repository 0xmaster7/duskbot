// The owner's own request to delete a Boat cloud's data. Nothing here deletes: a request sends an email with a one-time
// link, the link confirms it, and the retention reconciler acts after the undo window, through the same verdict as every
// other deletion (boat-retention.ts). Cookie session with its CSRF header, a sign-in from the last 10 minutes to ask,
// the owner only, rate limited.
import type { IncomingMessage, ServerResponse } from "node:http";
import { BoatLifecycleError } from "./boat-lifecycle.ts";
import type { CloudsService } from "./types.ts";

export const FRESH_SIGN_IN_MS = 10 * 60_000;
const DELETE_ROUTE = /^\/v1\/clouds\/([^/]+)\/delete-data(?:\/(confirm|cancel))?$/;

export interface BoatRoutesOptions {
  clouds: CloudsService;
  publicUrl: string;
  /** the signed-in owner (cookie session, CSRF checked on POST) and when that session signed in */
  owner(req: IncomingMessage): { id: string; signedInAt: number };
  readJson(req: IncomingMessage): Promise<Record<string, unknown>>;
  json(res: ServerResponse, status: number, data: unknown): void;
  now?: () => number;
}

export function createBoatRoutes(options: BoatRoutesOptions) {
  const now = options.now ?? Date.now, limits = new Map<string, { count: number; until: number }>();
  function limit(key: string, max: number, windowMs: number) {
    const item = limits.get(key);
    if (!item || item.until <= now()) { limits.set(key, { count: 1, until: now() + windowMs }); return; }
    if (++item.count > max) throw new BoatLifecycleError(429, "rate_limited");
  }
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const match = DELETE_ROUTE.exec(url.pathname);
    if (!match) return false;
    try {
      if (req.method !== "POST") throw new BoatLifecycleError(404, "not_found");
      if (req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new BoatLifecycleError(415, "invalid_request");
      const owner = options.owner(req), lifecycle = options.clouds.boat;
      const cloud = options.clouds.owned(owner.id, match[1]!);
      if (!cloud || cloud.backend !== "boat" || !lifecycle) throw new BoatLifecycleError(404, "not_found");
      const data = await options.readJson(req);
      if (!match[2]) {
        if (now() - owner.signedInAt > FRESH_SIGN_IN_MS) throw new BoatLifecycleError(403, "reauth_required");
        limit(`ask:${owner.id}`, 3, 86_400_000);
        lifecycle.requestDelete(cloud, token => `${options.publicUrl}/clouds/${cloud.id}/delete#${token}`);
        options.json(res, 202, { ok: true, emailed: true });
        return true;
      }
      limit(`act:${owner.id}`, 20, 3_600_000);
      if (match[2] === "confirm") {
        if (typeof data.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(data.token)) throw new BoatLifecycleError(400, "invalid_request");
        const executeAfter = lifecycle.confirmDelete(cloud, data.token);
        options.json(res, 200, { ok: true, deleteScheduledAt: executeAfter });
        return true;
      }
      lifecycle.cancelDelete(cloud);
      options.json(res, 200, { ok: true });
      return true;
    } catch (error) {
      const known = error instanceof BoatLifecycleError || (error instanceof Error && "status" in error && "code" in error);
      const status = known ? (error as { status: number }).status : 500, code = known ? (error as { code: string }).code : "failed";
      options.json(res, status, { error: code, code });
      return true;
    }
  }
  return { handle };
}
