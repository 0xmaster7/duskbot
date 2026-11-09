// how long a bot computer's egress dial takes, in a local simulation of a phone-network mac: the real agent, link
// service and app proxy, with each of the mac's legs (to the relay, and the direct path) given a one-way delay and a
// bandwidth. run `node link-service/test/egress-dial-sim.mjs [checkout]` against a checkout to compare builds.
import { createServer as createHttpServer, request } from "node:http";
import { connect, createServer } from "node:net";
import { PassThrough, Writable } from "node:stream";
import { pathToFileURL } from "node:url";

const root = pathToFileURL(`${process.argv[2] ?? new URL("../..", import.meta.url).pathname}/`.replace(/\/+$/, "/"));
const { createTunnelAgent } = await import(new URL("link-service/agent.mjs", root));
const { createLinkService, sha256hex } = await import(new URL("link-service/src/app.mjs", root));
const { createEgressDialer, createEgressEndpoint } = await import(new URL("electron/vps-link-egress.mjs", root));
const { createTunnelProxy, relayFetch } = await import(new URL("electron/vps-link-protocol.mjs", root));

const NET = { oneWayMs: 40, downBps: 2.5 * 1024 * 1024, upBps: 0.6 * 1024 * 1024, bufferBytes: 384 * 1024, siteConnectMs: 30 };
const DIALS = 15;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

/**
 * one direction of the mac's link: `bps` bytes a second, `oneWayMs` on the wire, and at most `buffer` bytes in the
 * network and the socket buffers, so a sender is held back (as a socket's write pushes back) instead of queueing forever
 */
function link(bps, buffer = NET.bufferBytes) {
  let free = 0, queued = 0, timer = null;
  const line = [];
  const waiters = [];
  const pump = () => {
    timer = null;
    while (line.length && line[0].at <= Date.now()) {
      const { size, deliver } = line.shift();
      queued -= size;
      deliver();
    }
    while (waiters.length && queued < buffer) waiters.shift()();
    if (line.length) timer = setTimeout(pump, Math.max(1, line[0].at - Date.now()));
  };
  return {
    send(size, deliver) {
      queued += size;
      free = Math.max(free, Date.now()) + (size * 1000) / bps;
      line.push({ at: free + NET.oneWayMs, size, deliver });
      if (!timer) timer = setTimeout(pump, Math.max(1, line[0].at - Date.now()));
    },
    room: () => (queued < buffer ? Promise.resolve() : new Promise((resolve) => waiters.push(resolve))),
  };
}

function shapedStream(source, wire) {
  const reader = source.getReader();
  return new ReadableStream({
    start(controller) {
      void (async () => {
        for (;;) {
          await wire.room();
          const { value, done } = await reader.read();
          wire.send(done ? 0 : value.byteLength, () => { try { if (done) controller.close(); else controller.enqueue(value); } catch { /* the reader went away */ } });
          if (done) return;
        }
      })().catch((error) => { try { controller.error(error); } catch { /* closed */ } });
    },
    cancel: (reason) => reader.cancel(reason),
  });
}

/** the app's fetch to the relay over the mac's link: posts queue on the uplink, replies on the downlink */
function macFetch({ up, down }) {
  const inner = relayFetch();
  const go = async (url, init = {}) => {
    await up.room();
    await new Promise((resolve) => up.send((init.body ? Buffer.byteLength(init.body) : 0) + 300, resolve));
    const response = await inner(url, init);
    await sleep(NET.oneWayMs);
    if (!response.body) return response;
    return new Response(shapedStream(response.body, down), { status: response.status, headers: response.headers });
  };
  return Object.assign(go, { connectAware: true, multiplexed: inner.multiplexed, postsInFlight: inner.postsInFlight, close: inner.close, reset: inner.reset });
}

function shapedPipe(wire) {
  const output = new PassThrough();
  let last = Promise.resolve();
  const input = new Writable({
    write(chunk, _encoding, callback) {
      last = new Promise((resolve) => wire.send(chunk.length, () => { output.write(chunk); resolve(); }));
      void wire.room().then(() => callback());
    },
    final(callback) { void last.then(() => { output.end(); callback(); }); },
    destroy(error, callback) { output.destroy(); callback(error); },
  });
  return { input, output };
}

async function socksDial(port) {
  const started = performance.now();
  const socket = connect({ port, host: "127.0.0.1" });
  socket.on("error", () => {});
  const reads = [];
  let wake = () => {};
  socket.on("data", (chunk) => { reads.push(chunk); wake(); });
  socket.on("close", () => wake());
  const read = async (size) => {
    for (;;) {
      const all = Buffer.concat(reads);
      if (all.length >= size) { reads.length = 0; reads.push(all.subarray(size)); return all.subarray(0, size); }
      if (socket.destroyed) return null;
      await new Promise((resolve) => { wake = resolve; });
    }
  };
  await new Promise((resolve) => socket.once("connect", resolve));
  socket.write(Buffer.from([5, 1, 0]));
  await read(2);
  const name = Buffer.from("site.example");
  const request = Buffer.alloc(7 + name.length);
  request.set([5, 1, 0, 3, name.length]);
  name.copy(request, 5);
  request.writeUInt16BE(443, 5 + name.length);
  socket.write(request);
  const reply = await read(10);
  const ms = performance.now() - started;
  socket.destroy();
  return { ms, ok: reply?.[1] === 0 };
}

async function scenario({ direct, load }) {
  const service = createLinkService({ base: "http://sim.invalid", scriptPath: new URL("link-service/install.sh", root).pathname, agentPath: new URL("link-service/agent.mjs", root).pathname, trustProxy: false });
  const credentials = { id: "abcdefghij", key: Buffer.alloc(32, 3).toString("base64url"), token: "a".repeat(43) };
  const vpsToken = "v".repeat(43);
  service.store.tunnels.set(credentials.id, { id: credentials.id, vpsVerifier: sha256hex(vpsToken), appVerifier: sha256hex(credentials.token) });
  const relay = createHttpServer((req, res) => void service.handler(req, res));
  const base = `http://127.0.0.1:${await listen(relay)}`;
  const big = Buffer.alloc(3 * 1024 * 1024, 1);
  const omb = createHttpServer((_req, res) => { res.writeHead(200, { "content-type": "application/octet-stream" }); res.end(big); });
  const ombPort = await listen(omb);
  const site = createServer((socket) => { socket.on("error", () => {}); socket.pipe(socket); });
  const sitePort = await listen(site);
  const agent = createTunnelAgent({ ...credentials, base, token: vpsToken, server: { host: "127.0.0.1", port: ombPort }, log: () => {}, egress: {
    bind: () => ({ host: "127.0.0.1", port: 0, allow: () => true }), reportMs: 100, dialMs: 8000, probe: null, report: async () => ({ enabled: true }),
  } });
  const running = agent.run();
  const dialer = createEgressDialer({
    interfaces: () => ({}),
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    connect: () => {
      const real = connect({ host: "127.0.0.1", port: sitePort });
      const emit = real.emit.bind(real);
      real.emit = (event, ...args) => (event === "connect" ? Boolean(setTimeout(() => emit(event, ...args), NET.siteConnectMs)) : emit(event, ...args));
      return real;
    },
  });
  // the relay and the direct path share the mac's one connection, as they do on a phone network
  const mac = { up: link(NET.upBps), down: link(NET.downBps) };
  const fetch = macFetch(mac);
  const links = [];
  const directSpec = direct && agent.direct ? { connect: async () => {
    const up = shapedPipe(mac.up), down = shapedPipe(mac.down);
    agent.direct.accept(up.output, down.input);
    const link = { readable: down.output, writable: up.input, close: () => { up.input.destroy(); down.input.destroy(); } };
    links.push(link);
    return link;
  } } : direct ? { connect: async () => {
    // a checkout without a direct hub: its `direct` command served the connection in a process of its own
    const { serveDirect } = await import(new URL("link-service/agent.mjs", root));
    const up = shapedPipe(mac.up), down = shapedPipe(mac.down);
    serveDirect({ input: up.output, output: down.input, id: credentials.id, key: credentials.key, server: { host: "127.0.0.1", port: ombPort }, log: () => {} });
    const link = { readable: down.output, writable: up.input, close: () => { up.input.destroy(); down.input.destroy(); } };
    links.push(link);
    return link;
  } } : null;
  const proxy = createTunnelProxy({ ...credentials, base, fetch, log: () => {}, ...(directSpec ? { direct: directSpec } : {}), egress: (tunnel) => createEgressEndpoint({ ...tunnel, dialer }) });
  const origin = await proxy.start();
  for (let i = 0; i < 300 && !(agent.egress.listening && agent.egress.online() && (!direct || proxy.transport() === "direct")); i += 1) await sleep(20);
  let loading = load, loaded = 0, loadFrom = 0, loadTo = 0;
  const downloads = (async () => {
    while (loading) {
      const url = new URL("/big", origin);
      await new Promise((resolve) => {
        request({ host: "127.0.0.1", port: url.port, path: "/big", headers: { host: url.host } }, (res) => { res.on("data", (chunk) => { if (loadFrom && !loadTo) loaded += chunk.length; }); res.on("end", resolve); res.on("error", resolve); }).on("error", resolve).end();
      });
    }
  })();
  if (load) await sleep(1500);
  const results = [];
  loadFrom = Date.now();
  for (let i = 0; i < DIALS; i += 1) { results.push(await socksDial(agent.egress.listening.port)); await sleep(150); }
  loadTo = Date.now();
  loading = false;
  await Promise.race([downloads, sleep(5000)]);
  agent.stop();
  await running;
  await proxy.close();
  fetch.close();
  for (const link of links) link.close();
  service.close();
  relay.closeAllConnections();
  omb.closeAllConnections?.();
  await Promise.all([new Promise((resolve) => relay.close(resolve)), new Promise((resolve) => omb.close(resolve)), new Promise((resolve) => site.close(resolve))]);
  if (process.env.SIM_ALL) console.log(results.map((one) => `${Math.round(one.ms)}${one.ok ? "" : "!"}`).join(" "));
  const sorted = results.filter((one) => one.ok).map((one) => one.ms).sort((a, b) => a - b);
  const at = (q) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]) : null);
  return { median: at(0.5), p90: at(0.9), failed: results.length - sorted.length, path: direct && agent.direct ? "direct" : "relay", loadMBps: load ? (loaded / 1048576 / ((loadTo - loadFrom) / 1000)).toFixed(2) : "-" };
}

console.log(`checkout ${root.pathname}; mac one-way ${NET.oneWayMs} ms, down ${NET.downBps / 1048576} MB/s, up ${NET.upBps / 1048576} MB/s, ${NET.bufferBytes / 1024} KB buffered, site connect ${NET.siteConnectMs} ms`);
for (const [label, spec] of [["relay, idle", { direct: false, load: false }], ["relay, desktop download", { direct: false, load: true }], ["direct up, idle", { direct: true, load: false }], ["direct up, desktop download", { direct: true, load: true }]]) {
  const got = await scenario(spec);
  console.log(`${label.padEnd(28)} egress via ${got.path.padEnd(6)} median ${String(got.median).padStart(5)} ms  p90 ${String(got.p90).padStart(5)} ms  failed ${got.failed}/${DIALS}  download ${got.loadMBps} MB/s`);
}
process.exit(0);
