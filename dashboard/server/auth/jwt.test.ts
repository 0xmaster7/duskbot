import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";
import { createJwtVerifier, decodeJws, fetchJson, signEs256Jwt, type JwtOptions } from "./jwt.ts";

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = { ...rsa.publicKey.export({ format: "jwk" }), alg: "RS256", kid: "rsa", use: "sig" };
const ecJwk = { ...ec.publicKey.export({ format: "jwk" }), alg: "ES256", kid: "ec", use: "sig" };
const epoch = 1_800_000_000;
const claims = { iss: "https://issuer.test", aud: "client", sub: "subject", nonce: "expected-nonce", iat: epoch, exp: epoch + 600 };
function token(changes: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const input = [{ alg: "RS256", kid: "rsa", ...header }, { ...claims, ...changes }].map(value => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".");
  return `${input}.${sign("sha256", Buffer.from(input), rsa.privateKey).toString("base64url")}`;
}
describe("identity JWTs", () => {
  let server: Server, url: string, time: number, count: number, response: string, expected: JwtOptions;
  beforeAll(async () => {
    server = createServer((req, res) => {
      count++;
      if (req.url === "/redirect") { res.writeHead(302, { location: "/keys" }); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json" }); res.end(response);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error();
    url = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); });
  beforeEach(() => {
    time = epoch * 1000; count = 0; response = JSON.stringify({ keys: [jwk, ecJwk] });
    expected = { jwksUrl: url + "/keys", issuers: [claims.iss], clientId: "client", nonce: claims.nonce, algorithms: ["RS256"] };
  });
  const verifier = () => createJwtVerifier({ now: () => time });
  it("verifies RS256, audience arrays and the allowed issuer list", async () => {
    const verify = verifier();
    expect(await verify(token(), expected)).toEqual(claims);
    expect(await verify(token({ aud: ["other", "client"], azp: "client" }), expected)).toMatchObject({ sub: "subject" });
    expect(await verify(token({ iss: "other-issuer" }), { ...expected, issuers: [claims.iss, "other-issuer"] })).toMatchObject({ sub: "subject" });
    expect(count).toBe(1);
  });
  it.each([
    ["wrong audience", { aud: "other" }, {}], ["wrong array audience", { aud: ["other"] }, {}], ["wrong authorized party", { aud: ["client"], azp: "other" }, {}],
    ["malformed audience", { aud: ["client", 42] }, {}], ["wrong issuer", { iss: "other" }, {}], ["wrong nonce", { nonce: "other" }, {}],
    ["expired", { exp: epoch - 61 }, {}], ["missing expiry", { exp: null }, {}], ["future issued at", { iat: epoch + 61 }, {}], ["missing issued at", { iat: null }, {}],
    ["none", {}, { alg: "none" }], ["HS256", {}, { alg: "HS256" }], ["unexpected ES256", {}, { alg: "ES256" }], ["unknown key", {}, { kid: "unknown" }],
    ["critical header", {}, { crit: ["custom"] }],
  ])("refuses %s", async (_name, changes, header) => {
    await expect(verifier()(token(changes, header), expected)).rejects.toThrow();
  });
  it("allows only the 60 second clock skew", async () => {
    expect(await verifier()(token({ exp: epoch - 59, iat: epoch + 60 }), expected)).toMatchObject({ sub: "subject" });
    await expect(verifier()(token({ exp: epoch - 60 }), expected)).rejects.toThrow();
  });
  it("refuses bad signatures, malformed compact tokens and noncanonical base64url", async () => {
    const good = token(), parts = good.split(".");
    await expect(verifier()(`${parts[0]}.${parts[1]}.${Buffer.alloc(256).toString("base64url")}`, expected)).rejects.toThrow();
    for (const value of ["", "a.b", good + ".extra", good + "=", "x".repeat(65_537)]) expect(() => decodeJws(value)).toThrow();
  });
  it("signs and verifies ES256 in P1363 format only when allowed", async () => {
    const signed = signEs256Jwt({ alg: "ES256", kid: "ec" }, claims, ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    expect(decodeJws(signed).signature).toHaveLength(64);
    expect(await verifier()(signed, { ...expected, algorithms: ["ES256"] })).toEqual(claims);
    await expect(verifier()(signed, expected)).rejects.toThrow();
    expect(() => signEs256Jwt({ alg: "RS256" }, claims, "bad")).toThrow();
    expect(() => signEs256Jwt({ alg: "ES256" }, claims, rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString())).toThrow();
  });
  it.each([
    { ...jwk, use: "enc" }, { ...jwk, alg: "ES256" }, { ...jwk, key_ops: ["encrypt"] }, { ...jwk, kty: "EC" },
  ])("rejects incompatible key metadata", async key => {
    response = JSON.stringify({ keys: [key] });
    await expect(verifier()(token(), expected)).rejects.toThrow();
  });
  it("rejects duplicate kids", async () => {
    response = JSON.stringify({ keys: [jwk, jwk] });
    await expect(verifier()(token(), expected)).rejects.toThrow();
  });
  it("caches for an hour and deduplicates unknown-key refreshes to once per minute", async () => {
    const verify = verifier();
    await Promise.all([verify(token(), expected), verify(token(), expected)]);
    expect(count).toBe(1);
    const unknown = token({}, { kid: "rotated" });
    await expect(verify(unknown, expected)).rejects.toThrow(); expect(count).toBe(1);
    time += 60_000;
    await Promise.all([expect(verify(unknown, expected)).rejects.toThrow(), expect(verify(unknown, expected)).rejects.toThrow()]);
    expect(count).toBe(2);
    response = JSON.stringify({ keys: [{ ...jwk, kid: "rotated" }] });
    time += 60_000;
    expect(await verify(unknown, expected)).toMatchObject({ sub: "subject" }); expect(count).toBe(3);
    time += 3_600_000;
    await verify(token({ iat: time / 1000, exp: time / 1000 + 600 }, { kid: "rotated" }), expected); expect(count).toBe(4);
  });
  it("bounds JWKS responses, rejects redirects and uses injected fetch with a deadline", async () => {
    const request = vi.fn<typeof fetch>((input, init) => fetch(input, init));
    await createJwtVerifier({ fetch: request, now: () => time })(token(), expected);
    expect(request).toHaveBeenCalledWith(expected.jwksUrl, expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
    await expect(fetchJson(fetch, url + "/redirect")).rejects.toThrow();
    response = JSON.stringify({ keys: [], padding: "a".repeat(65_536) });
    await expect(verifier()(token(), expected)).rejects.toThrow();
    response = "{invalid";
    await expect(verifier()(token(), expected)).rejects.toThrow();
  });
});
