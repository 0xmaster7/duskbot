import { describe, expect, it } from "vitest";
import { homeEgressEndpoint, unlimitTunnelConnections, unprotectWith } from "./vps-link-main.mjs";

describe("unprotectWith", () => {
  const sealed = `e:${Buffer.from("watch-token").toString("base64")}`;
  it("reads electron's { result } answer from async safeStorage", async () => {
    const unprotect = unprotectWith({ decrypt: async (value) => ({ shouldReEncrypt: false, result: value.toString() }) });
    expect(await unprotect(sealed)).toBe("watch-token");
  });
  it("still reads a bare string answer and plain values", async () => {
    const unprotect = unprotectWith({ decrypt: async (value) => value.toString() });
    expect(await unprotect(sealed)).toBe("watch-token");
    expect(await unprotect("p:plain")).toBe("plain");
  });
});

describe("unlimitTunnelConnections", () => {
  it("lifts chromium's per-host connection cap for loopback names only", () => {
    const switches = [];
    unlimitTunnelConnections({ commandLine: { appendSwitch: (...args) => switches.push(args) } });
    expect(switches).toEqual([["ignore-connections-limit", "localhost"]]);
  });
});

describe("homeEgressEndpoint", () => {
  it("builds the home's egress endpoint without a seenAs lookup (was a ReferenceError)", () => {
    const touched = [];
    const tunnel = { send: () => true, bytes: () => true, queued: () => 0, onDrain: () => {} };
    const endpoint = homeEgressEndpoint(tunnel, { touch: () => touched.push(1) });
    expect(typeof endpoint.handle).toBe("function");
    expect(typeof endpoint.start).toBe("function");
    expect(typeof homeEgressEndpoint(tunnel).handle).toBe("function");
  });
});
