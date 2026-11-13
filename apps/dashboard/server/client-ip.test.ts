import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { clientIp, rateIp } from "./client-ip.ts";

const req = (headers: Record<string, string>, remote = "127.0.0.1") => ({ headers, socket: { remoteAddress: remote } }) as unknown as IncomingMessage;

describe("clientIp", () => {
  it("takes the proxy's own entry, never the client's", () => {
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), true)).toBe("203.0.113.9");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.9" }), false)).toBe("127.0.0.1");
  });
  it("trusts CF-Connecting-IP only when the proxy's peer was Cloudflare", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.1.1.1, 172.68.10.20", "cf-connecting-ip": "198.51.100.7" }), true)).toBe("198.51.100.7");
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.9", "cf-connecting-ip": "198.51.100.7" }), true)).toBe("203.0.113.9");
    expect(clientIp(req({ "x-forwarded-for": "2a06:98c0:3600::103", "cf-connecting-ip": "2001:db8::1" }), true)).toBe("2001:db8::1");
    expect(clientIp(req({ "x-forwarded-for": "172.68.10.20", "cf-connecting-ip": "not an ip" }), true)).toBe("172.68.10.20");
  });
});

describe("rateIp", () => {
  it("counts every address of one IPv6 /64 as one caller and leaves IPv4 alone", () => {
    expect(rateIp("203.0.113.9")).toBe("203.0.113.9");
    expect(rateIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(rateIp("2001:db8:a:b::1")).toBe("2001:db8:a:b::/64");
    expect(rateIp("2001:0db8:000a:000b:1234:5678:9abc:def0")).toBe("2001:db8:a:b::/64");
    expect(rateIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(rateIp("2001:db8::1")).toBe(rateIp("2001:db8:0:0:ffff::2"));
    expect(rateIp("2001:db8:a:c::1")).not.toBe(rateIp("2001:db8:a:b::1"));
    expect(rateIp("fe80::1%en0")).toBe("fe80:0:0:0::/64");
    expect(rateIp("unknown")).toBe("unknown");
  });
});
