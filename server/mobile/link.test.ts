import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseMobileLink, type MobilePairingResponse, type MobileRedeemResponse } from "../../shared/mobile-link.ts";
import type { RequestAuth } from "../request-auth.ts";
import { SessionRegistry } from "../sessions.ts";
import { createMobileLink, mobileLookupRelay } from "./link.ts";
import { lookupKeys, openLookup } from "./lookup.ts";
import type { PushMessage, PushTarget } from "./push.ts";

const owner: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
const service: RequestAuth = { kind: "loopback", scopes: ["client"], trust: "service" };
const fakeReq = (body: unknown, headers: Record<string, string> = {}) => ({ headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...headers }, socket: { remoteAddress: "127.0.0.1" }, body } as unknown as IncomingMessage & { body: unknown });

function fakeRes() {
  const out = { status: 0, body: undefined as unknown, headers: {} as Record<string, string>, closed: false };
  const res = { setHeader: (name: string, value: string) => { out.headers[name] = value; }, once: () => res, writableEnded: false, destroyed: false } as unknown as ServerResponse;
  return { res, out };
}
const json = (res: ServerResponse, status: number, body: unknown) => { const own = res as unknown as { _out?: { status: number; body: unknown } }; own._out = { status, body }; };
const readBody = async (req: IncomingMessage) => (req as IncomingMessage & { body: unknown }).body;

let dir: string, sessions: SessionRegistry, lookups: Array<{ url: string; body: { id: string; sealed: string } }>, sent: Array<{ target: PushTarget; message: PushMessage }>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omb-mobile-"));
  sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
  lookups = [];
  sent = [];
});
afterEach(() => { sessions.close(); rmSync(dir, { recursive: true, force: true }); });

function link(extra: Partial<Parameters<typeof createMobileLink>[0]> = {}) {
  return createMobileLink({
    dataDir: dir, sessions,
    workspace: () => ({ name: "Test box", environmentId: "env-1", kind: "server" }),
    publicOrigin: () => "https://box.example.com",
    refusal: () => null,
    lookupRelay: "http://relay.test",
    fetch: (async (url: string, init: RequestInit) => { lookups.push({ url, body: JSON.parse(String(init.body)) }); return new Response("{}", { status: 201 }); }) as typeof fetch,
    push: { configured: ["apns"], send: async (target, message) => { sent.push({ target, message }); return "sent"; } },
    log: () => {},
    ...extra,
  });
}

async function call(mobile: ReturnType<typeof link>, auth: RequestAuth, method: string, path: string, body: unknown = {}) {
  const { res } = fakeRes();
  const handled = await mobile.route({ req: fakeReq(body), res, path, method, auth, json, readBody });
  return { handled, ...(res as unknown as { _out: { status: number; body: any } })._out };
}
async function redeem(mobile: ReturnType<typeof link>, body: unknown) {
  const { res } = fakeRes();
  await mobile.publicRoute(fakeReq(body), res, "/api/mobile/redeem", "POST", json, readBody);
  return (res as unknown as { _out: { status: number; body: any } })._out;
}

describe("mobile link", () => {
  it("pairs a phone from a QR payload, lists it, and revoking ends its session", async () => {
    const mobile = link();
    const paired = await call(mobile, owner, "POST", "/api/mobile/pairing", { companion: [{ url: "http://192.168.1.4:8810", kind: "lan", priority: 30 }] });
    expect(paired.status).toBe(200);
    const answer = paired.body as MobilePairingResponse;
    const payload = parseMobileLink(answer.link)!;
    expect(payload.via.map((one) => one.kind)).toEqual(["https", "companion"]);
    expect(payload.workspace).toEqual({ name: "Test box", environmentId: "env-1", kind: "server" });
    expect(answer.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    // the typed code finds the same payload, sealed so the relay cannot read it
    expect(lookups[0].url).toBe("http://relay.test/v1/lookups");
    expect(lookups[0].body.id).toBe(lookupKeys(answer.code!).id);
    expect(openLookup(answer.code!, lookups[0].body.sealed)).toEqual(payload);

    const redeemed = await redeem(mobile, { secret: payload.grant.secret, attemptId: "attempt-0001", device: { name: "Sid's iPhone", platform: "ios" } });
    expect(redeemed.status).toBe(200);
    const phone = redeemed.body as MobileRedeemResponse;
    expect(phone.token).toMatch(/^omb_sess_/);
    expect(phone.scopes.sort()).toEqual(["admin", "client"]);
    expect(sessions.authenticate(phone.token)?.label).toBe("Sid's iPhone");
    // a lost answer is fetched again with the same attempt, never a second device
    expect((await redeem(mobile, { secret: payload.grant.secret, attemptId: "attempt-0001", device: { name: "x", platform: "ios" } })).body.token).toBe(phone.token);
    expect((await redeem(mobile, { secret: payload.grant.secret, attemptId: "attempt-0002", device: { name: "x", platform: "ios" } })).status).toBe(401);

    const listed = await call(mobile, owner, "GET", "/api/mobile/devices");
    expect(listed.body.devices).toHaveLength(1);
    expect(JSON.stringify(readFileSync(join(dir, "mobile-devices.json"), "utf8"))).not.toContain(phone.token);
    expect((await call(mobile, owner, "DELETE", `/api/mobile/devices/${phone.device.id}`)).status).toBe(200);
    expect(sessions.authenticate(phone.token)).toBeNull();
    expect((await call(mobile, owner, "GET", "/api/mobile/devices")).body.devices).toHaveLength(0);
  });

  it("only the owner or an admin pairs, and a service caller or client session cannot", async () => {
    const mobile = link();
    expect((await call(mobile, service, "POST", "/api/mobile/pairing")).status).toBe(403);
    const client = sessions.issue({ label: "c", scopes: ["client"] });
    const auth: RequestAuth = { kind: "session", session: sessions.authenticate(client.token)!, via: "bearer", scopes: ["client"] };
    expect((await call(mobile, auth, "POST", "/api/mobile/pairing")).status).toBe(403);
    expect((await call(link({ refusal: () => "no" }), owner, "POST", "/api/mobile/pairing")).status).toBe(403);
  });

  it("refuses a grant nothing could reach", async () => {
    const mobile = link({ publicOrigin: () => null, lookupRelay: null });
    expect((await call(mobile, owner, "POST", "/api/mobile/pairing")).status).toBe(409);
  });

  it("serves relay channels to the link agent and hands a phone its own channel", async () => {
    const mobile = link({ publicOrigin: () => null });
    const agent = { base: "https://link.test", tunnel: "abcdefghij", pub: "A".repeat(43) };
    // the agent's sync: answered at once the first time, then held until something changes
    const first = await call(mobile, owner, "POST", "/api/mobile/relay/sync", { ...agent, applied: 0, wait: 0 });
    expect(first.body).toEqual({ rev: 1, channels: [] });
    expect((await call(mobile, service, "POST", "/api/mobile/relay/sync", { ...agent, applied: 0 })).status).toBe(403);

    const syncing = call(mobile, owner, "POST", "/api/mobile/relay/sync", { ...agent, applied: 1, wait: 5 });
    const pairing = call(mobile, owner, "POST", "/api/mobile/pairing");
    const held = await syncing;
    expect(held.body.channels).toEqual([expect.objectContaining({ kind: "grant", verifier: expect.stringMatching(/^[0-9a-f]{64}$/), key: expect.any(String) })]);
    // the agent registered it with the relay: the pairing answer now carries the relay transport
    void call(mobile, owner, "POST", "/api/mobile/relay/sync", { ...agent, applied: held.body.rev, wait: 5 });
    const answer = (await pairing).body as MobilePairingResponse;
    const relay = answer.payload.via.find((one) => one.kind === "relay")!;
    expect(relay).toMatchObject({ kind: "relay", base: "https://link.test", channel: held.body.channels[0].id });
    expect(answer.payload.workspace.kind).toBe("vps");

    const redeeming = redeem(mobile, { secret: answer.payload.grant.secret, attemptId: "attempt-0003", device: { name: "Pixel", platform: "android" }, relay: { pub: "B".repeat(43), verifier: "c".repeat(64) } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const next = await call(mobile, owner, "POST", "/api/mobile/relay/sync", { ...agent, applied: held.body.rev, wait: 0 });
    const device = next.body.channels.find((one: { kind: string }) => one.kind === "device");
    expect(device).toMatchObject({ pub: "B".repeat(43), verifier: "c".repeat(64) });
    void call(mobile, owner, "POST", "/api/mobile/relay/sync", { ...agent, applied: next.body.rev, wait: 0 });
    const phone = (await redeeming).body as MobileRedeemResponse;
    expect(phone.relay).toEqual({ base: "https://link.test", channel: device.id, agentPub: agent.pub });

    // revoking a session anywhere (the session list in settings) drops the phone and its channel
    sessions.revoke(sessions.authenticate(phone.token)!.id);
    const after = await call(mobile, owner, "POST", "/api/mobile/relay/sync", { ...agent, applied: next.body.rev, wait: 0 });
    expect(after.body.channels.some((one: { kind: string }) => one.kind === "device")).toBe(false);
  });

  it("registers a phone for push and fans notifications out without their text", async () => {
    const mobile = link();
    const answer = (await call(mobile, owner, "POST", "/api/mobile/pairing")).body as MobilePairingResponse;
    const phone = (await redeem(mobile, { secret: answer.payload.grant.secret, attemptId: "attempt-0004", device: { name: "p", platform: "ios" } })).body as MobileRedeemResponse;
    const auth: RequestAuth = { kind: "session", session: sessions.authenticate(phone.token)!, via: "bearer", scopes: phone.scopes };
    expect((await call(mobile, owner, "PUT", "/api/mobile/push", { service: "apns", token: "abcdef0123456789" })).status).toBe(403);
    expect((await call(mobile, auth, "PUT", "/api/mobile/push", { service: "apns", token: "abcdef0123456789", environment: "sandbox" })).body).toEqual({ ok: true, delivering: true });
    await mobile.notify({ id: "n1", at: 1, read: false, kind: "reply", botId: "b1", botName: "Nova", threadId: "t1", title: "Nova", body: "secret text" });
    expect(sent).toEqual([{ target: { service: "apns", token: "abcdef0123456789", environment: "sandbox" }, message: { id: "n1", kind: "reply", title: "Nova", botId: "b1", botName: "Nova", threadId: "t1" } }]);
    await mobile.notify({ id: "n1", at: 1, read: false, kind: "reply", botId: "b1", botName: "Nova", threadId: "t1", title: "Nova", body: "again" });
    expect(sent).toHaveLength(1);
  });

  it("reads the typed-code relay from the environment", () => {
    expect(mobileLookupRelay({})).toBe("https://link.apps.siddz.com");
    expect(mobileLookupRelay({ OMB_MOBILE_RELAY: "off" })).toBeNull();
    expect(mobileLookupRelay({ OMB_MOBILE_RELAY: "http://127.0.0.1:9" })).toBe("http://127.0.0.1:9");
  });
});
