import type { LookupAddress } from "node:dns";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fetchableUrl, guardedGet, MAX_HOPS, pinnedRequest, type Answer, type PinnedRequest, type RequestOptions } from "./net.ts";

const html = (type: string) => type.startsWith("text/html");
const options = (over: Partial<RequestOptions> = {}): RequestOptions => ({
  limit: 1024, partial: true, accept: html, headers: {}, signal: AbortSignal.timeout(5_000), ...over,
});
const v4 = (address: string): LookupAddress => ({ address, family: 4 });
const v6 = (address: string): LookupAddress => ({ address, family: 6 });

function fake(dns: Record<string, LookupAddress[]>, answers: Record<string, Partial<Answer>>) {
  const asked: string[] = [];
  const request: PinnedRequest = async (url, address) => {
    asked.push(`${url.href} @${address.address}`);
    return { status: 200, location: null, type: "text/html", body: Buffer.from("ok"), truncated: false, ...answers[url.href] };
  };
  return { asked, deps: { resolve: async (host: string) => dns[host] ?? [], request } };
}

describe("fetchableUrl", () => {
  it("takes http on 80 and https on 443 only, never credentials or other schemes", () => {
    expect(fetchableUrl(new URL("https://a.example/x"))).toBe(true);
    expect(fetchableUrl(new URL("http://a.example:80/x"))).toBe(true);
    for (const href of ["https://a.example:8443/", "http://a.example:6379/", "https://user:pw@a.example/", "ftp://a.example/", "file:///etc/passwd", "gopher://a.example/"]) {
      expect(fetchableUrl(new URL(href)), href).toBe(false);
    }
  });
});

describe("guardedGet", () => {
  it("refuses every private, loopback, link-local, metadata or translated address", async () => {
    for (const address of [v4("127.0.0.1"), v4("10.0.0.8"), v4("192.168.1.1"), v4("169.254.169.254"), v4("100.100.100.200"), v4("0.0.0.0"), v6("::1"), v6("fd00::1"), v6("fe80::1"), v6("::ffff:127.0.0.1"), v6("64:ff9b::7f00:1")]) {
      const { asked, deps } = fake({ "a.example": [address] }, {});
      expect(await guardedGet(new URL("https://a.example/"), options(), deps), address.address).toEqual({ ok: false, reason: "blocked" });
      expect(asked).toEqual([]);
    }
  });

  it("refuses a name with one private answer among public ones", async () => {
    const { asked, deps } = fake({ "a.example": [v4("93.184.215.14"), v4("127.0.0.1")] }, {});
    expect(await guardedGet(new URL("https://a.example/"), options(), deps)).toEqual({ ok: false, reason: "blocked" });
    expect(asked).toEqual([]);
  });

  it("refuses address literals that point inward", async () => {
    const { deps } = fake({ "127.0.0.1": [v4("127.0.0.1")], "::1": [v6("::1")] }, {});
    expect((await guardedGet(new URL("http://127.0.0.1/"), options(), deps)).ok).toBe(false);
    expect((await guardedGet(new URL("http://[::1]/"), options(), deps)).ok).toBe(false);
  });

  it("checks again after every redirect, so a public page cannot bounce into the network", async () => {
    const { asked, deps } = fake(
      { "public.example": [v4("93.184.215.14")], "inside.example": [v4("10.0.0.5")] },
      { "https://public.example/go": { status: 302, location: "https://inside.example/admin" } },
    );
    expect(await guardedGet(new URL("https://public.example/go"), options(), deps)).toEqual({ ok: false, reason: "blocked" });
    expect(asked).toEqual(["https://public.example/go @93.184.215.14"]);
  });

  it("refuses a redirect to another scheme or port", async () => {
    const { deps } = fake({ "public.example": [v4("93.184.215.14")] }, {
      "https://public.example/a": { status: 301, location: "file:///etc/passwd" },
      "https://public.example/b": { status: 301, location: "http://public.example:2375/containers" },
    });
    expect(await guardedGet(new URL("https://public.example/a"), options(), deps)).toEqual({ ok: false, reason: "address" });
    expect(await guardedGet(new URL("https://public.example/b"), options(), deps)).toEqual({ ok: false, reason: "address" });
  });

  it("follows a few redirects to the end, pinned to each checked address, and stops a loop", async () => {
    const { asked, deps } = fake({ "a.example": [v4("93.184.215.14")], "b.example": [v4("93.184.215.15")] }, {
      "https://a.example/": { status: 301, location: "https://b.example/final" },
      "https://a.example/loop": { status: 302, location: "/loop" },
    });
    const got = await guardedGet(new URL("https://a.example/"), options(), deps);
    expect(got.ok && got.url.href).toBe("https://b.example/final");
    expect(asked).toEqual(["https://a.example/ @93.184.215.14", "https://b.example/final @93.184.215.15"]);
    expect(await guardedGet(new URL("https://a.example/loop"), options(), deps)).toEqual({ ok: false, reason: "hops" });
    expect(asked.length).toBe(2 + MAX_HOPS + 1);
  });

  it("refuses a body of the wrong type", async () => {
    const { deps } = fake({ "a.example": [v4("93.184.215.14")] }, { "https://a.example/": { type: "application/octet-stream" } });
    expect(await guardedGet(new URL("https://a.example/"), options(), deps)).toEqual({ ok: false, reason: "type" });
  });
});

describe("pinnedRequest", () => {
  let server: Server;
  let base: string;
  const big = "x".repeat(5_000);
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.headers.cookie || req.headers.authorization) { res.writeHead(400); res.end("credentials"); return; }
      if (req.url === "/gzip") {
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        res.end(gzipSync(`<title>zipped</title>${big}`));
        return;
      }
      if (req.url === "/bomb") {
        res.writeHead(200, { "content-type": "image/png", "content-encoding": "gzip" });
        res.end(gzipSync(Buffer.alloc(50 * 1024 * 1024)));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(big);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const loopback = v4("127.0.0.1");

  it("keeps the head of a long page and sends no credentials", async () => {
    const answer = await pinnedRequest(new URL(`${base}/page`), loopback, options());
    expect(answer.status).toBe(200);
    expect(answer.body.length).toBe(1024);
    expect(answer.truncated).toBe(true);
  });

  it("decompresses and caps after decompression", async () => {
    const answer = await pinnedRequest(new URL(`${base}/gzip`), loopback, options());
    expect(answer.body.toString().startsWith("<title>zipped</title>")).toBe(true);
    expect(answer.body.length).toBe(1024);
    const bomb = await pinnedRequest(new URL(`${base}/bomb`), loopback, options({ partial: false, limit: 5 * 1024 * 1024, accept: (type) => type.startsWith("image/") }));
    expect(bomb.status).toBe(413);
  });

  it("is never reached for this machine through the guard", async () => {
    expect(await guardedGet(new URL(`${base.replace(/:\d+$/, "")}/page`), options())).toEqual({ ok: false, reason: "blocked" });
  });
});
