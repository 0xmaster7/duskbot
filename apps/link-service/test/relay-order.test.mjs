// the relay's tunnel queues: numbered posts land in order, and a streamed read hands frames on as they are queued
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLinkService, sha256hex } from "../src/app.mjs";
import { readFrameBatches } from "../../../electron/vps-link-protocol.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const id = "abcdefghij", app = "a".repeat(43), vps = "v".repeat(43);
let service, server, base;

beforeEach(async () => {
  service = createLinkService({ base: "http://link.test", scriptPath: `${root}install.sh`, agentPath: `${root}agent.mjs`, trustProxy: false });
  service.store.tunnels.set(id, { id, vpsVerifier: sha256hex(vps), appVerifier: sha256hex(app) });
  server = createServer((req, res) => void service.handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  service.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const post = (frames, extra = {}) => fetch(`${base}/v1/tunnels/${id}/to-app`, {
  method: "POST", headers: { authorization: `Bearer ${vps}`, "content-type": "application/json" }, body: JSON.stringify({ frames, ...extra }),
}).then((response) => response.json());
const take = () => fetch(`${base}/v1/tunnels/${id}/to-app?wait=0`, { headers: { authorization: `Bearer ${app}` } }).then((response) => response.json());

describe("the egress lane", () => {
  it("is read out ahead of what already waits in the main queue, in its own order", async () => {
    await post(["main1", "main2"], { epoch: "e".repeat(12), seq: 0 });
    await post(["laneA"], { lane: true });
    await post(["laneB"], { lane: true });
    await post(["main3"], { epoch: "e".repeat(12), seq: 1 });
    expect((await take()).frames).toEqual(["laneA", "laneB", "main1", "main2", "main3"]);
  });

  it("has room of its own: a full main queue never refuses it", async () => {
    let refused = null;
    for (let i = 0; i < 8 && !refused; i += 1) {
      const answer = await post(Array(256).fill("desk"), { epoch: "e".repeat(12), seq: i });
      if (answer.code === "queue_full") refused = answer;
    }
    expect(refused?.code).toBe("queue_full");
    expect(await post(["lane"], { lane: true })).toEqual({ ok: true, ordered: true });
    expect((await take()).frames[0]).toBe("lane");
  });

  it("is never held behind a numbered post that has not come yet", async () => {
    await post(["late"], { epoch: "e".repeat(12), seq: 1 });
    await post(["lane"], { lane: true });
    expect((await take()).frames).toEqual(["lane"]);
  });
});

describe("numbered posts", () => {
  it("from a writer that was writing before this node restarted start where they are, after a moment, not 5 s", async () => {
    await post(["resumed"], { epoch: "r".repeat(12), seq: 41 });
    expect((await take()).frames).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await take()).frames).toEqual(["resumed"]);
    await post(["next"], { epoch: "r".repeat(12), seq: 42 });
    expect((await take()).frames).toEqual(["next"]);
  });

  it("say the relay orders them, and land in the writer's order however they arrive", async () => {
    expect(await post(["cccc"], { epoch: "e".repeat(12), seq: 2 })).toEqual({ ok: true, ordered: true });
    await post(["bbbb"], { epoch: "e".repeat(12), seq: 1 });
    expect((await take()).frames).toEqual([]);
    await post(["aaaa"], { epoch: "e".repeat(12), seq: 0 });
    expect((await take()).frames).toEqual(["aaaa", "bbbb", "cccc"]);
  });

  it("drop a retried post the relay already queued, and start over for a restarted writer", async () => {
    await post(["aaaa"], { epoch: "e".repeat(12), seq: 0 });
    await post(["aaaa"], { epoch: "e".repeat(12), seq: 0 });
    await post(["bbbb"], { epoch: "f".repeat(12), seq: 0 });
    await post(["late"], { epoch: "e".repeat(12), seq: 1 });
    expect((await take()).frames).toEqual(["aaaa", "bbbb"]);
  });

  it("from an older writer without numbers still queue as they come", async () => {
    await post(["aaaa"]);
    await post(["bbbb"]);
    expect((await take()).frames).toEqual(["aaaa", "bbbb"]);
  });
});

describe("a streamed read", () => {
  it("answers at once, then hands each post on as its own line", async () => {
    const response = await fetch(`${base}/v1/tunnels/${id}/to-app?wait=2&stream=1`, { headers: { authorization: `Bearer ${app}` } });
    expect(response.headers.get("content-type")).toMatch(/^application\/x-ndjson/);
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const lines = [];
    const reading = readFrameBatches(response, (frames) => lines.push({ frames, at: Date.now() }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const sent = Date.now();
    await post(["aaaa"], { epoch: "e".repeat(12), seq: 0 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await post(["bbbb"], { epoch: "e".repeat(12), seq: 1 });
    expect(await reading).toBe(true);
    expect(lines.map((line) => line.frames)).toEqual([[], ["aaaa"], ["bbbb"]]);
    expect(lines[1].at - sent).toBeLessThan(500);
  });

  it("ends when the same end opens a newer one, so frames never go to a dead read", async () => {
    const older = await fetch(`${base}/v1/tunnels/${id}/to-app?wait=20&stream=1`, { headers: { authorization: `Bearer ${app}` } });
    const olderLines = [];
    const olderDone = readFrameBatches(older, (frames) => olderLines.push(frames));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const newer = await fetch(`${base}/v1/tunnels/${id}/to-app?wait=1&stream=1`, { headers: { authorization: `Bearer ${app}` } });
    const newerLines = [];
    const newerDone = readFrameBatches(newer, (frames) => newerLines.push(frames));
    await olderDone;
    await post(["aaaa"]);
    await newerDone;
    expect(olderLines).toEqual([[]]);
    expect(newerLines.flat()).toEqual(["aaaa"]);
  });
});
