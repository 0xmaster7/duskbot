import type { IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";

// Cloudflare's published edge ranges (https://www.cloudflare.com/ips/, read 2026-11-11). Only a request whose proxy saw
// one of these as its peer may name the visitor in CF-Connecting-IP; from anywhere else that header is the client's own.
const CLOUDFLARE_V4 = ["173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20",
  "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"];
const CLOUDFLARE_V6 = ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"];
const cloudflare = new BlockList();
for (const range of CLOUDFLARE_V4) { const [net, bits] = range.split("/"); cloudflare.addSubnet(net!, Number(bits), "ipv4"); }
for (const range of CLOUDFLARE_V6) { const [net, bits] = range.split("/"); cloudflare.addSubnet(net!, Number(bits), "ipv6"); }

export function fromCloudflare(address: string): boolean {
  const kind = isIP(address);
  return kind !== 0 && cloudflare.check(address, kind === 4 ? "ipv4" : "ipv6");
}

/**
 * The caller's address for rate limits. Behind one trusted proxy (nginx with `$proxy_add_x_forwarded_for`) the proxy
 * appends the address it saw, so only the last entry is trustworthy: the first ones are whatever the client sent.
 * When that address is Cloudflare's edge, the visitor is Cloudflare's CF-Connecting-IP.
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  const forwarded = req.headers["x-forwarded-for"];
  const last = trustProxy && typeof forwarded === "string" ? forwarded.split(",").pop()!.trim() : "";
  const visitor = req.headers["cf-connecting-ip"];
  if (last && fromCloudflare(last) && typeof visitor === "string" && isIP(visitor.trim())) return visitor.trim();
  return last || (req.socket.remoteAddress ?? "unknown");
}

/**
 * The bucket a rate limit counts an address in: an IPv4 address as it is, an IPv6 address by its /64, since one home or
 * server gets a whole /64 and could otherwise pick a fresh address for every request.
 */
export function rateIp(address: string): string {
  if (isIP(address) !== 6) return address;
  const lower = address.toLowerCase().split("%")[0]!;
  if (lower.startsWith("::ffff:") && isIP(lower.slice(7)) === 4) return lower.slice(7);
  const [head = "", tail = ""] = lower.split("::");
  const left = head ? head.split(":") : [], right = tail ? tail.split(":") : [];
  const groups = lower.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map(group => group.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}
