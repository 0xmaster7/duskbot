import { createServer, request, type IncomingMessage, type Server } from "node:http";
import { createGunzip } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { openEventStream, type EventStreamOut } from "./sse-gzip.ts";
import { gzipTunnelReplies } from "./tunnel-gzip.ts";

const HEADERS = { "content-type": "text/event-stream", "cache-control": "no-cache" };
let server: Server | null = null;
let out: EventStreamOut | null = null;

afterEach(async () => {
  out?.end();
  server?.closeAllConnections();
  await new Promise((resolve) => server ? server.close(resolve) : resolve(undefined));
  server = null;
  out = null;
});

async function stream(onTunnel: boolean, acceptEncoding: string | undefined): Promise<IncomingMessage> {
  const handle = (_req: IncomingMessage, res: import("node:http").ServerResponse) => {
    out = openEventStream(res, HEADERS);
    out.write(`data: ${JSON.stringify({ kind: "hello" })}\n\n`);
  };
  server = createServer(onTunnel ? gzipTunnelReplies(handle) : handle);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/api/events", headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {} }, resolve);
    req.on("error", reject);
    req.end();
  });
}

/** the stream's decoded text so far, and a wait for `until` to show up while the stream stays open */
function reader(res: IncomingMessage) {
  const body = res.headers["content-encoding"] === "gzip" ? res.pipe(createGunzip()) : res;
  let text = "";
  const waiting = new Set<() => void>();
  body.setEncoding("utf8");
  body.on("data", (chunk: string) => { text += chunk; for (const check of [...waiting]) check(); });
  return (until: string) => new Promise<string>((resolve) => {
    const check = () => { if (text.includes(until)) { waiting.delete(check); resolve(text); } };
    waiting.add(check);
    check();
  });
}

describe("openEventStream", () => {
  it("gzips a tunnel stream for a client that takes gzip, and every event decodes as soon as it is written", async () => {
    const res = await stream(true, "gzip, deflate");
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.headers.vary).toBe("Accept-Encoding");
    const read = reader(res);
    expect(await read('"hello"')).toContain("data: ");
    const second = read('"seq":2');
    out!.write(`id: s:2\ndata: ${JSON.stringify({ kind: "runtime", seq: 2 })}\n\n`);
    expect(await second).toContain('"seq":2');
  });

  it("leaves a stream alone off the tunnel or for a client without gzip", async () => {
    const local = await stream(false, "gzip");
    expect(local.headers["content-encoding"]).toBeUndefined();
    expect(await reader(local)('"hello"')).toContain("data: ");
    out?.end();
    server?.closeAllConnections();
    await new Promise((resolve) => server!.close(resolve));
    const plain = await stream(true, undefined);
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(await reader(plain)('"hello"')).toContain("data: ");
  });

  it("shrinks a turn's repeated frames several times over", async () => {
    const res = await stream(true, "gzip");
    let wire = 0;
    res.on("data", (chunk: Buffer) => { wire += chunk.length; });
    const frame = (seq: number) => `id: s:${seq}\ndata: ${JSON.stringify({ kind: "bot", seq, bot: { id: "5f6f6365-1f34-4075-9c96-c5845f8e1bbf", name: "Moss", busy: true, tasks: Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, title: `task ${i}` })) } })}\n\n`;
    let raw = 0;
    const done = reader(res)('"seq":12,');
    for (let seq = 1; seq <= 12; seq++) { raw += Buffer.byteLength(frame(seq)); out!.write(frame(seq)); }
    await done;
    expect(wire * 4).toBeLessThan(raw);
  });
});
