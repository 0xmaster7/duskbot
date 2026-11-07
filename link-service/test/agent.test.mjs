import { ClientRequest, createServer } from "node:http";
import { describe, expect, it } from "vitest";

import { createTunnelAgent, openFrame, sealBytes, sealFrame } from "../agent.mjs";

const id = "abcdefghij";
const key = Buffer.alloc(32, 3);
const credentials = { base: "http://relay.test", id, key: key.toString("base64url"), token: "v".repeat(43) };

function pendingFetch(signal) {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(signal.reason);
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve("timed out"), 300); })]);
  } finally {
    clearTimeout(timer);
  }
}

describe("tunnel agent shutdown", () => {
  it("a successful reply post wakes a failed poll's retry delay", async () => {
    let retrying, release, resumed;
    const retry = new Promise((resolve) => { retrying = resolve; });
    const posted = new Promise((resolve) => { release = resolve; });
    const active = new Promise((resolve) => { resumed = resolve; });
    let polls = 0;
    const agent = createTunnelAgent({ ...credentials, log: retrying, fetchImpl: async (_url, init) => {
      if (init.method === "POST") { await posted; return Response.json({ ok: true }); }
      polls += 1;
      if (polls === 1) return Response.json({ frames: [sealFrame(key, id, "to-vps", { t: "ctl", r: "r".repeat(12), op: "ping" })] });
      if (polls === 2) throw new Error("temporary poll disconnect");
      resumed("resumed");
      return pendingFetch(init.signal);
    } });
    const running = agent.run();
    try {
      await retry;
      release();
      expect(await bounded(active)).toBe("resumed");
    } finally {
      release();
      agent.stop();
      await running;
    }
  });

  it("aborts an in-flight reply post when stopped", async () => {
    let posted;
    const started = new Promise((resolve) => { posted = resolve; });
    let first = true;
    const agent = createTunnelAgent({ ...credentials, log: () => {}, fetchImpl: async (_url, init) => {
      if (init.method === "POST") {
        posted(init.signal);
        return pendingFetch(init.signal);
      }
      if (!first) return pendingFetch(init.signal);
      first = false;
      return Response.json({ frames: [sealFrame(key, id, "to-vps", { t: "ctl", r: "r".repeat(12), op: "ping" })] });
    } });
    const running = agent.run();
    try {
      const signal = await started;
      agent.stop();
      expect(signal.aborted).toBe(true);
      expect(await bounded(running)).toBe("stopped");
    } finally {
      agent.stop();
      await running;
    }
  });

  it("wakes retry backoff immediately when stopped", async () => {
    let retrying;
    const started = new Promise((resolve) => { retrying = resolve; });
    const agent = createTunnelAgent({ ...credentials, log: retrying, fetchImpl: async () => { throw new Error("offline"); } });
    const running = agent.run();
    try {
      await started;
      agent.stop();
      expect(await bounded(running)).toBe("stopped");
    } finally {
      agent.stop();
      await running;
    }
  });

  it("an unlinked reply post also stops an outstanding long poll", async () => {
    let first = true;
    const agent = createTunnelAgent({ ...credentials, log: () => {}, fetchImpl: async (_url, init) => {
      if (init.method === "POST") return Response.json({ error: "not found" }, { status: 404 });
      if (!first) return pendingFetch(init.signal);
      first = false;
      return Response.json({ frames: [sealFrame(key, id, "to-vps", { t: "ctl", r: "r".repeat(12), op: "ping" })] });
    } });
    const running = agent.run();
    try {
      expect(await bounded(running)).toBe("unlinked");
    } finally {
      agent.stop();
      await running;
    }
  });
});

describe("tunnel agent receiving buffers", () => {
  it("fails a flooded upload within its own buffer limit while another request completes", async () => {
    const server = createServer((_req, res) => res.end("healthy"));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const slow = "s".repeat(12), healthy = "h".repeat(12);
    const frames = [sealFrame(key, id, "to-vps", { t: "req", r: slow, method: "POST", path: "/slow", end: false })];
    for (let index = 0; index < 128; index += 1) frames.push(sealBytes(key, id, "to-vps", slow, Buffer.alloc(128 * 1024, 1)));
    frames.push(sealFrame(key, id, "to-vps", { t: "req", r: healthy, method: "GET", path: "/healthy", end: true }));
    let first = true, maxBuffered = 0, finish;
    const done = new Promise((resolve) => { finish = resolve; });
    const replies = [];
    const agent = createTunnelAgent({ ...credentials, server: { host: "127.0.0.1", port: server.address().port }, log: () => {}, fetchImpl: async (_url, init) => {
      if (init.method === "POST") {
        for (const value of JSON.parse(init.body).frames) {
          const frame = openFrame(key, id, "to-app", value);
          replies.push(frame);
          if (frame.r === healthy && frame.t === "end") finish();
        }
        return Response.json({ ok: true });
      }
      if (!first) return pendingFetch(init.signal);
      first = false;
      return Response.json({ frames });
    } });
    const originalWrite = ClientRequest.prototype.write;
    ClientRequest.prototype.write = function (...args) {
      const result = originalWrite.apply(this, args);
      if (this.path === "/slow") maxBuffered = Math.max(maxBuffered, this.writableLength);
      return result;
    };
    const running = agent.run();
    try {
      await expect.poll(() => replies.some((frame) => frame.r === healthy && frame.t === "end"), { timeout: 5000 }).toBe(true);
      await done;
      expect(maxBuffered).toBeGreaterThan(7 * 1024 * 1024);
      expect(maxBuffered).toBeLessThanOrEqual(8 * 1024 * 1024);
      const errors = replies.filter((frame) => frame.r === slow && frame.t === "err");
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("could not keep up");
      expect(replies.some((frame) => frame.r === healthy && frame.t === "head" && frame.status === 200)).toBe(true);
      expect(Buffer.concat(replies.filter((frame) => frame.r === healthy && frame.t === "bytes").map((frame) => frame.b)).toString()).toBe("healthy");
    } finally {
      agent.stop();
      await running;
      ClientRequest.prototype.write = originalWrite;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
