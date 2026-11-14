// GET /api/link-preview?url=: what a link in chat points at (server/link-preview/service.ts).
// GET /api/link-preview/image/<id>: that preview's picture, fetched by this server.
import { join } from "node:path";

import { LINK_PREVIEW_IMAGE_PATH } from "../../shared/link-preview.ts";
import { DATA_DIR } from "../config.ts";
import { createLinkPreviews, type LinkPreviews } from "../link-preview/service.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createLinkPreviewRoutes(previews: LinkPreviews): RouteHandler {
  return async ({ res, url, path, method, json }) => {
    if (method !== "GET") return PASS;
    if (path === "/api/link-preview") {
      const preview = await previews.get(url.searchParams.get("url"));
      if (!preview) return json(res, 400, { error: "url must be an http or https address" });
      res.setHeader("cache-control", "private, max-age=600");
      return json(res, 200, { preview });
    }
    if (!path.startsWith(LINK_PREVIEW_IMAGE_PATH)) return PASS;
    const image = await previews.image(path.slice(LINK_PREVIEW_IMAGE_PATH.length));
    if (!image) {
      res.setHeader("cache-control", "private, max-age=600");
      return json(res, 404, { error: "no image" });
    }
    res.writeHead(200, {
      "content-type": image.type,
      "content-length": String(image.body.length),
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-origin",
    });
    res.end(image.body);
  };
}

let shared: RouteHandler | null = null;
/** The table's entry: the cache sits in the data folder's device-only cache, made on the first request. */
export const linkPreviewRoutes: RouteHandler = (ctx) => {
  shared ??= createLinkPreviewRoutes(createLinkPreviews({ dir: join(DATA_DIR, "cache", "link-previews") }));
  return shared(ctx);
};
