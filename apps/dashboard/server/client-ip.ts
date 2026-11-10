import type { IncomingMessage } from "node:http";

/**
 * The caller's address for rate limits. Behind one trusted proxy (nginx with `$proxy_add_x_forwarded_for`) the proxy
 * appends the address it saw, so only the last entry is trustworthy: the first ones are whatever the client sent.
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  const forwarded = req.headers["x-forwarded-for"];
  const last = trustProxy && typeof forwarded === "string" ? forwarded.split(",").pop()!.trim() : "";
  return last || (req.socket.remoteAddress ?? "unknown");
}
