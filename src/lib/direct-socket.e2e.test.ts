// Two processes, as in screen-direct.e2e.test.ts: the bot browser's stream (a stand-in route with the same path and
// auth rules) rides the direct peer as a WebSocket, whole messages kept; with ICE unable to connect it opens over the
// relay socket and the code holding it sees the same events either way.
import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { RTCPeerConnection as NodePeer } from "node-datachannel/polyfill";
import { afterAll, beforeAll, expect, it } from "vitest";
import WebSocket from "ws";
import { openStreamSocket } from "./direct-socket";
import { openDirectScreen, resetDirectScreen } from "./screen-direct";

const root = fileURLToPath(new URL("../..", import.meta.url));
const FRAME = 96 * 1024;
const FPS = 10;
const Peer = NodePeer as unknown as typeof RTCPeerConnection;
const STREAM = "http://workspace.example/api/bots/test-bot/browser/stream?maxWidth=1280&maxHeight=800";
let child: ChildProcess;
let port = 0;
let token = "";

beforeAll(async () => {
  child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "server/testing/screen-direct-peer.ts"], {
    cwd: root, stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, STREAM_FRAME: String(FRAME), STREAM_FPS: String(FPS) },
  });
  const line = await new Promise<string>((resolve, reject) => {
    createInterface({ input: child.stdout! }).once("line", resolve);
    child.once("exit", (code) => reject(new Error(`peer exited ${code}`)));
  });
  ({ port, token } = JSON.parse(line) as { port: number; token: string });
}, 30_000);
afterAll(() => { child?.kill("SIGTERM"); });

const headers = () => ({ host: "workspace.example", "x-forwarded-proto": "https", cookie: `test_session=${token}` });

function linkFetch(rewrite: (sdp: string) => string = (sdp) => sdp): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.stringify({ ...JSON.parse(String(init.body)), sdp: rewrite(JSON.parse(String(init.body)).sdp) }) : undefined;
    const answer = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path: url, method: init?.method ?? "GET", headers: { ...headers(), "content-type": "application/json" } }, (res) => {
        let text = "";
        res.on("data", (chunk) => text += chunk);
        res.on("end", () => resolve({ status: res.statusCode!, text }));
      });
      req.once("error", reject);
      req.end(body);
    });
    const parsed = answer.text ? JSON.parse(answer.text) as { sdp?: string } : {};
    if (typeof parsed.sdp === "string") parsed.sdp = rewrite(parsed.sdp);
    return new Response(JSON.stringify(parsed), { status: answer.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
const noCandidates = (sdp: string) => sdp.split(/\r?\n/).filter((line) => !line.startsWith("a=candidate") && line !== "a=end-of-candidates").join("\r\n");
/** the relay socket as the link proxy would carry it: same path, the signed-in cookie */
const relaySocket = (url: string) => {
  const target = new URL(url);
  return new WebSocket(`ws://127.0.0.1:${port}${target.pathname}${target.search}`, { headers: headers() }) as unknown as globalThis.WebSocket;
};

function watch(socket: globalThis.WebSocket) {
  socket.binaryType = "arraybuffer";
  const seen = { open: false, texts: [] as Array<Record<string, unknown>>, frames: 0, bytes: 0, sizes: new Set<number>(), close: null as null | { code: number; reason: string } };
  socket.addEventListener("open", () => { seen.open = true; });
  socket.addEventListener("message", (event) => {
    const data = (event as MessageEvent).data;
    if (typeof data === "string") seen.texts.push(JSON.parse(data));
    else { seen.frames++; seen.bytes += (data as ArrayBuffer).byteLength; seen.sizes.add((data as ArrayBuffer).byteLength); }
  });
  socket.addEventListener("close", (event) => { seen.close = { code: (event as CloseEvent).code, reason: (event as CloseEvent).reason }; });
  return seen;
}

async function rate(read: () => number) {
  const before = read();
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  return Math.round((read() - before) / 2);
}

it("carries the bot browser's stream peer to peer, whole messages and close codes kept", async () => {
  resetDirectScreen();
  const socket = openStreamSocket(STREAM, {
    hostname: "vps-abc.localhost",
    open: (url, options) => openDirectScreen(url, { ...options, fetch: linkFetch(), RTCPeerConnection: Peer, iceServers: [] }),
    socket: () => { throw new Error("the relay was not needed"); },
  });
  const seen = watch(socket);
  await expect.poll(() => seen.texts[0], { timeout: 8_000 }).toEqual({ type: "hello", via: "direct" });
  expect(seen.open).toBe(true);
  socket.send("hi");
  await expect.poll(() => seen.texts.some((one) => one.type === "echo" && one.text === "hi")).toBe(true);
  const direct = await rate(() => seen.bytes);
  console.log(`browser stream direct: ${direct} B/s (sent ${FRAME * FPS} B/s)`);
  expect(direct).toBeGreaterThan(FRAME * FPS * 0.8);
  expect([...seen.sizes]).toEqual([FRAME]);
  socket.send("bye");
  await expect.poll(() => seen.close, { timeout: 5_000 }).toEqual({ code: 4404, reason: "tab gone" });
}, 30_000);

it("opens the stream over the relay when ICE cannot connect, and the holder sees the same events", async () => {
  resetDirectScreen();
  const socket = openStreamSocket(STREAM, {
    hostname: "vps-abc.localhost",
    open: (url, options) => openDirectScreen(url, { ...options, fetch: linkFetch(noCandidates), RTCPeerConnection: Peer, iceServers: [], connectMs: 1_500 }),
    socket: relaySocket,
  });
  const seen = watch(socket);
  await expect.poll(() => seen.texts[0]?.type, { timeout: 10_000 }).toBe("hello");
  expect(["timeout", "ice-failed"]).toContain(seen.texts[0]!.via);
  const relay = await rate(() => seen.bytes);
  console.log(`browser stream relay: ${relay} B/s (sent ${FRAME * FPS} B/s)`);
  expect(relay).toBeGreaterThan(FRAME * FPS * 0.8);
  socket.send("bye");
  await expect.poll(() => seen.close?.code, { timeout: 5_000 }).toBe(4404);
}, 30_000);

it("refuses to carry anything but a stream socket", async () => {
  const answer = await linkFetch()(`/api/direct/socket?path=${encodeURIComponent("/api/bots")}`, { method: "POST", body: JSON.stringify({ type: "offer", sdp: "v=0" }) });
  expect(answer.status).toBe(400);
});
