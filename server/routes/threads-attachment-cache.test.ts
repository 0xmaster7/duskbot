import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ATTACHMENTS_DIR } from "../attachments.ts";
import { DATA_DIR } from "../config.ts";
import type { ModelSelection } from "../contracts.ts";
import { json, readBody } from "../harness/http.ts";
import { messagePages } from "../host/message-pages.ts";
import * as mdb from "../message-db.ts";
import type { RequestAuth } from "../request-auth.ts";
import { Store } from "../store.ts";
import { dispatchRoutes } from "./table.ts";
import { createThreadRoutes, type ThreadRouteDeps } from "./threads.ts";

const sonnet: ModelSelection = { instanceId: "claude", model: "claude-sonnet-5" };
const servers: Server[] = [];

function pngHeader(w: number, h: number): Buffer {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12, "latin1");
  head.writeUInt32BE(w, 16);
  head.writeUInt32BE(h, 20);
  return head;
}

beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function serve(): Promise<string> {
  const deps = {
    store: new Store(() => sonnet), viewerFor: () => ({}), visibleTo: () => ({ bot: () => true, group: () => true }),
    desktopMutationToken: () => undefined, companionMutationToken: () => undefined, cliOwnerToken: () => undefined, userName: () => "Milind",
    uploads: { note: () => {}, owns: () => true },
  } as unknown as ThreadRouteDeps;
  const routes = [createThreadRoutes(deps)];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = { kind: "loopback", scopes: ["admin"] } as RequestAuth;
    try {
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
    } catch (error) {
      json(res, 500, { error: String(error) });
    }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("GET /api/attachments/<name> caching", () => {
  it("lets only the browser's private cache keep bytes, keyed to the session, and answers a revalidation with 304", async () => {
    mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    const name = "33333333-3333-4333-8333-333333333333.png";
    writeFileSync(join(ATTACHMENTS_DIR, name), pngHeader(640, 480));
    const base = await serve();

    const first = await fetch(`${base}/api/attachments/${name}`);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(first.headers.get("cdn-cache-control")).toBe("no-store");
    expect(first.headers.get("vary")).toBe("Cookie, Authorization");
    const etag = first.headers.get("etag");
    expect(etag).toBe(`"${name}:33"`);
    expect((await first.arrayBuffer()).byteLength).toBe(33);

    const again = await fetch(`${base}/api/attachments/${name}`, { headers: { "if-none-match": etag! } });
    expect(again.status).toBe(304);
    expect(again.headers.get("cache-control")).toContain("private");
    expect((await again.arrayBuffer()).byteLength).toBe(0);

    const other = await fetch(`${base}/api/attachments/${name}`, { headers: { "if-none-match": "\"something-else\"" } });
    expect(other.status).toBe(200);
  });

  it("returns the uploaded picture's size", async () => {
    const base = await serve();
    const uploaded = await fetch(`${base}/api/attachments`, { method: "POST", headers: { "content-type": "image/png" }, body: pngHeader(1920, 1080) });
    expect(uploaded.status).toBe(201);
    expect(((await uploaded.json()) as { media?: unknown }).media).toEqual({ w: 1920, h: 1080 });
  });
});

describe("stored picture sizes", () => {
  it("keeps sizes on a message when it is written, and fills old rows lazily and in a backfill", async () => {
    mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    const fresh = "44444444-4444-4444-8444-444444444444.png";
    const old = "55555555-5555-4555-8555-555555555555.png";
    const later = "66666666-6666-4666-8666-666666666666.png";
    for (const [name, w, h] of [[fresh, 800, 600], [old, 300, 900], [later, 1000, 500]] as const) writeFileSync(join(ATTACHMENTS_DIR, name), pngHeader(w, h));
    const store = new Store(() => sonnet);
    const bot = store.createBot({ name: "Pixel" });

    const written = store.appendMessage(bot.threadId, { role: "bot", kind: "text", text: "", attachments: [{ kind: "image", path: join(ATTACHMENTS_DIR, fresh), mime: "image/png" }] });
    expect(written.media).toEqual({ [fresh]: { w: 800, h: 600 } });
    expect(mdb.readMessage(bot.threadId, written.id)?.media).toEqual({ [fresh]: { w: 800, h: 600 } });

    // rows stored before sizes existed
    const legacy = { id: "legacy-1", at: Date.now(), role: "user" as const, kind: "text" as const, text: `<attached-image path="${join(ATTACHMENTS_DIR, old)}" name="tall.png" />` };
    mdb.appendMessage(bot.threadId, legacy);
    const legacyLater = { id: "legacy-2", at: Date.now() + 1, role: "bot" as const, kind: "text" as const, text: `![shot](/api/attachments/${later})` };
    mdb.appendMessage("t-elsewhere", legacyLater);

    const reopened = new Store(() => sonnet);
    const page = messagePages(reopened).messagePage(bot.threadId, 50);
    expect(page.messages.find((message) => message.id === "legacy-1")).toMatchObject({ media: { [old]: { w: 300, h: 900 } } });
    expect(mdb.readMessage(bot.threadId, "legacy-1")?.media).toEqual({ [old]: { w: 300, h: 900 } });

    expect(await reopened.backfillMediaSizes()).toBe(1);
    expect(mdb.readMessage("t-elsewhere", "legacy-2")?.media).toEqual({ [later]: { w: 1000, h: 500 } });
    expect(await reopened.backfillMediaSizes()).toBe(0);
  });
});
