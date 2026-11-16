import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import type { FeedbackPayload } from "../devs-report.ts";
import type { SendOutcome } from "../devs-report-send.ts";
import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import type { SessionRecord } from "../sessions.ts";
import { createFeedbackRoutes, FEEDBACK_LIMITS } from "./feedback.ts";
import { dispatchRoutes } from "./table.ts";

const sample = (name: string) => readFileSync(new URL(`../testing/fixtures/${name}`, import.meta.url));
const JPEG = sample("banner-metadata.jpg"), PNG = sample("banner-metadata.png");

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function serve(auth: RequestAuth, outcome: SendOutcome = { ok: true, id: "dr-abcdefghjk" }) {
  const sent: FeedbackPayload[] = [];
  const routes = [createFeedbackRoutes({ installId: "install-0001", appVersion: "0.2.14", platform: "darwin arm64, desktop app",
    send: async (payload) => { sent.push(payload); return outcome; } })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown) => fetch(`${base}/api/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { sent, post, base };
}

const owner: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
const session = (email?: string): RequestAuth => ({ kind: "session", via: "cookie", scopes: ["client"], session: { email } as unknown as SessionRecord });

describe("give feedback route", () => {
  it("is open to any signed-in session", () => {
    expect(requiredScope("POST", "/api/feedback")).toBe("client");
  });

  it("sends the words as feedback with the app's facts, and no address when signed out", async () => {
    const { sent, post, base } = await serve(owner);
    const answer = await post({ text: "  The Connect apps window opened behind the chat  " });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({ id: "dr-abcdefghjk" });
    expect(sent).toEqual([{ installId: "install-0001", source: "feedback", description: "The Connect apps window opened behind the chat", appVersion: "0.2.14",
      platform: "darwin arm64, desktop app", diagnostics: "" }]);
    expect((await fetch(`${base}/api/feedback`)).status).toBe(405);
  });

  it("takes the desktop's signed-in address on its own page, and only a session's own address from a session", async () => {
    const desktop = await serve(owner);
    await desktop.post({ text: "hi", email: "Ada@Example.com" });
    expect(desktop.sent[0]).toMatchObject({ contactEmail: "ada@example.com", contact: "ada@example.com" });

    const signedIn = await serve(session("grace@example.com"));
    await signedIn.post({ text: "hi", email: "someone-else@example.com" });
    expect(signedIn.sent[0]).toMatchObject({ contactEmail: "grace@example.com" });

    const anonymous = await serve(session());
    await anonymous.post({ text: "hi", email: "someone-else@example.com" });
    expect(anonymous.sent[0]).not.toHaveProperty("contactEmail");

    const service = await serve({ kind: "loopback", scopes: ["client"], trust: "service" });
    await service.post({ text: "hi", email: "ada@example.com" });
    expect(service.sent[0]).not.toHaveProperty("contact");
  });

  it("sends pictures with their metadata taken out", async () => {
    const { sent, post } = await serve(owner);
    expect((await post({ text: "two pictures", images: [JPEG.toString("base64"), PNG.toString("base64")] })).status).toBe(201);
    const images = sent[0]!.images!;
    expect(images.map((image) => image.type)).toEqual(["image/jpeg", "image/png"]);
    for (const image of images) expect(Buffer.from(image.data, "base64").includes(Buffer.from("Secret"))).toBe(false);
  });

  it("refuses empty words, too many pictures, something that isn't a picture, and a body over the limit", async () => {
    const { sent, post } = await serve(owner);
    expect((await post({ text: "   " })).status).toBe(400);
    expect((await post({ text: "x".repeat(FEEDBACK_LIMITS.text + 1) })).status).toBe(400);
    const four = Array.from({ length: FEEDBACK_LIMITS.images + 1 }, () => PNG.toString("base64"));
    expect((await post({ text: "too many", images: four })).status).toBe(400);
    const notPicture = await post({ text: "a script", images: [Buffer.from("<svg onload=alert(1)>").toString("base64")] });
    expect(notPicture.status).toBe(400);
    expect((await notPicture.json() as { code: string }).code).toBe("format");
    expect((await post({ text: "huge", images: ["A".repeat(FEEDBACK_LIMITS.body)] })).status).toBe(413);
    expect(sent).toHaveLength(0);
  });

  it("says when the team's endpoint is busy, refuses, or can't be reached", async () => {
    const limited = await serve(owner, { ok: false, retry: true, why: "limited", retryAfterMs: 120_000 });
    const answer = await limited.post({ text: "hi" });
    expect(answer.status).toBe(429);
    expect((await answer.json() as { retryAfter: number }).retryAfter).toBe(120);
    expect((await (await serve(owner, { ok: false, retry: false, why: "refused", detail: "Invalid installId." })).post({ text: "hi" })).status).toBe(400);
    expect((await (await serve(owner, { ok: false, retry: true, why: "offline" })).post({ text: "hi" })).status).toBe(502);
  });
});
