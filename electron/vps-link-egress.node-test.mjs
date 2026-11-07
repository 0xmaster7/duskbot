import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { BlockList, connect, createServer } from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createLinkService } from "../link-service/src/app.mjs";
import { bridgeAddress, createEgressProxy, createTunnelAgent } from "../link-service/agent.mjs";
import { createEgressDialer, createEgressEndpoint, egressNameRefusal, egressRefusal, homeAddresses, seenAsCache } from "./vps-link-egress.mjs";
import { createTunnelProxy, sha256hex } from "./vps-link-protocol.mjs";

const listen = (server, host = "127.0.0.1") => new Promise((resolve) => server.listen(0, host, () => resolve(server.address().port)));
const home = {
  en0: [{ address: "192.168.1.20", netmask: "255.255.255.0", family: "IPv4", mac: "", internal: false, cidr: "192.168.1.20/24" },
    { address: "2a02:1210:abcd:1::20", netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", mac: "", internal: false, cidr: "2a02:1210:abcd:1::20/64", scopeid: 0 }],
  lo0: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "", internal: true, cidr: "127.0.0.1/8" }],
};

test("names that reach this computer's own network are never looked up", () => {
  for (const name of ["localhost", "api.localhost", "printer.local", "nas.home.arpa", "router.lan", "intranet", "db.internal", "box.localdomain", "", "a b.com", "x".repeat(300)]) {
    assert.ok(egressNameRefusal(name), name);
  }
  for (const name of ["api.ipify.org", "www.instagram.com", "example.com.", "93.184.216.34", "2606:4700::1111"]) assert.equal(egressNameRefusal(name), null, name);
});

test("only web ports on the public internet pass, never this computer's home", () => {
  const own = new BlockList();
  own.addAddress("192.168.1.20", "ipv4");
  const homeList = homeAddresses(home, "149.88.103.35");
  const refused = {
    "127.0.0.1": "loopback", "::1": "loopback", "::ffff:127.0.0.1": "loopback", "10.1.2.3": "home-network", "172.20.0.1": "home-network",
    "192.168.1.1": "home-network", "192.168.7.7": "home-network", "100.64.0.1": "home-network", "169.254.169.254": "metadata",
    "100.100.100.200": "metadata", "fd00:ec2::254": "metadata", "169.254.10.10": "link-local", "fe80::1": "link-local",
    "224.0.0.251": "reserved", "239.255.255.250": "reserved", "ff02::1": "reserved", "0.0.0.0": "reserved", "::": "reserved",
    // nat64 and 6to4 wrappers of loopback and the lan
    "64:ff9b::7f00:1": "loopback", "64:ff9b::c0a8:101": "home-network", "2002:7f00:1::": "loopback",
    // the home's own public address (its router answers there) and its public ipv6 prefix
    "149.88.103.35": "home-network", "2a02:1210:abcd:1::99": "home-network",
  };
  for (const [address, why] of Object.entries(refused)) assert.equal(egressRefusal(443, [address], { own, home: homeList }), why, address);
  assert.equal(egressRefusal(443, ["93.184.216.34", "2606:4700::1111"], { own, home: homeList }), null);
  for (const port of [22, 25, 3306, 8080, 8443, 0]) assert.equal(egressRefusal(port, ["93.184.216.34"], { own, home: homeList }), "port");
  // one private answer among public ones refuses the whole name
  assert.equal(egressRefusal(80, ["93.184.216.34", "10.0.0.5"], { own, home: homeList }), "home-network");
});

test("a name is looked up once and only the checked addresses are connected (dns rebinding)", async () => {
  const answers = [[{ address: "93.184.216.34", family: 4 }], [{ address: "127.0.0.1", family: 4 }]];
  let lookups = 0, given = null;
  const dialer = createEgressDialer({
    interfaces: () => home,
    resolve: async () => answers[Math.min(lookups++, answers.length - 1)],
    connect: (options) => {
      given = options;
      const socket = connect({ port: 9, host: "127.0.0.1" });
      socket.once("error", () => {});
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    },
  });
  const opened = await dialer.open({ host: "rebind.example", port: 443 });
  opened.socket.destroy();
  assert.equal(lookups, 1);
  assert.equal(given.host, "93.184.216.34");
  const seen = await new Promise((resolve) => given.lookup("rebind.example", { all: true }, (_error, list) => resolve(list)));
  assert.deepEqual(seen, [{ address: "93.184.216.34", family: 4 }]);

  const mixed = createEgressDialer({ interfaces: () => home, resolve: async () => [{ address: "93.184.216.34", family: 4 }, { address: "192.168.1.1", family: 4 }], connect: () => assert.fail("never dialled") });
  assert.deepEqual(await mixed.open({ host: "split.example", port: 443 }), { refused: "home-network" });
  const metadata = createEgressDialer({ interfaces: () => home, resolve: async () => [{ address: "169.254.169.254", family: 4 }], connect: () => assert.fail("never dialled") });
  assert.deepEqual(await metadata.open({ host: "meta.example", port: 80 }), { refused: "metadata" });
  const self = createEgressDialer({ interfaces: () => home, seenAs: async () => "149.88.103.35", resolve: async () => [{ address: "149.88.103.35", family: 4 }], connect: () => assert.fail("never dialled") });
  assert.deepEqual(await self.open({ host: "my-router.example", port: 443 }), { refused: "home-network" });
  assert.deepEqual(await mixed.open({ host: "printer.local", port: 443 }), { refused: "home-network" });
  assert.deepEqual(await mixed.open({ host: "93.184.216.34", port: 22 }), { refused: "port" });
});

test("the home's public address is asked once and kept", async () => {
  let asked = 0, t = 0;
  const seenAs = seenAsCache(async () => { asked += 1; return "149.88.103.35"; }, { ttlMs: 1000, now: () => t });
  assert.equal(await seenAs(), "149.88.103.35");
  assert.equal(await seenAs(), "149.88.103.35");
  assert.equal(asked, 1);
  t = 2000;
  await seenAs();
  assert.equal(asked, 2);
  const broken = seenAsCache(async () => { throw new Error("offline"); });
  assert.equal(await broken(), null);
});

test("the proxy answers only boxes on the bridge, never the bridge's own address", () => {
  const bridge = bridgeAddress("omb-desk0", { "omb-desk0": [{ address: "172.18.0.1", netmask: "255.255.0.0", family: "IPv4", mac: "", internal: false, cidr: "172.18.0.1/16" }] });
  assert.equal(bridge.host, "172.18.0.1");
  assert.equal(bridge.subnet.check("172.18.0.2", "ipv4"), true);
  assert.equal(bridge.subnet.check("172.17.0.2", "ipv4"), false);
  assert.equal(bridgeAddress("omb-desk0", {}), null);
});

async function socks(port, host, targetPort, { greet = true } = {}) {
  const socket = connect({ port, host: "127.0.0.1" });
  socket.on("error", () => {});
  await once(socket, "connect");
  const reads = [];
  let wake = null;
  socket.on("data", (chunk) => { reads.push(chunk); wake?.(); });
  const read = async (size) => {
    for (;;) {
      const all = Buffer.concat(reads);
      if (all.length >= size) { reads.length = 0; if (all.length > size) reads.push(all.subarray(size)); return all.subarray(0, size); }
      const closed = await new Promise((resolve) => { wake = () => resolve(false); socket.once("close", () => resolve(true)); });
      if (closed && Buffer.concat(reads).length < size) return null;
    }
  };
  if (greet) {
    socket.write(Buffer.from([5, 1, 0]));
    assert.deepEqual([...await read(2)], [5, 0]);
  }
  const name = Buffer.from(host);
  const request = Buffer.alloc(7 + name.length);
  request.set([5, 1, 0, 3, name.length]);
  name.copy(request, 5);
  request.writeUInt16BE(targetPort, 5 + name.length);
  socket.write(request);
  const reply = await read(10);
  return { socket, reply: reply ? reply[1] : null, read };
}

async function fixture({ macOn = true, enabled = true, dialMs = 1500, endpoint = {} } = {}) {
  const root = fileURLToPath(new URL("../link-service/", import.meta.url));
  const service = createLinkService({ base: "http://fixture.invalid", scriptPath: `${root}install.sh`, agentPath: `${root}agent.mjs`, trustProxy: false });
  const credentials = { id: "abcdefghij", key: Buffer.alloc(32, 3).toString("base64url"), token: "a".repeat(43) };
  const vpsToken = "v".repeat(43);
  service.store.tunnels.set(credentials.id, { id: credentials.id, vpsVerifier: sha256hex(vpsToken), appVerifier: sha256hex(credentials.token) });
  const relay = createHttpServer((req, res) => void service.handler(req, res));
  const base = `http://127.0.0.1:${await listen(relay)}`;
  // the "public site": an echo server the fake resolver and connect send site.example to
  const site = createServer((socket) => { socket.on("error", () => {}); socket.pipe(socket); });
  const sitePort = await listen(site);
  const dials = [];
  const reports = [];
  const state = { enabled };
  const agent = createTunnelAgent({ ...credentials, base, token: vpsToken, server: { host: "127.0.0.1", port: 9 }, log: () => {}, egress: {
    bind: () => ({ host: "127.0.0.1", port: 0, allow: () => true }), reportMs: 100, dialMs,
    report: async (said) => { reports.push(said); return { enabled: state.enabled }; },
  } });
  const running = agent.run();
  const dialer = createEgressDialer({
    interfaces: () => home,
    resolve: async (host) => (host === "site.example" ? [{ address: "93.184.216.34", family: 4 }] : host === "lan.example" ? [{ address: "192.168.1.1", family: 4 }] : []),
    connect: (options) => { dials.push(options.host); return connect({ host: "127.0.0.1", port: sitePort }); },
  });
  const proxy = createTunnelProxy({ ...credentials, base, log: () => {}, egress: (tunnel) => createEgressEndpoint({ ...tunnel, dialer, ...endpoint }) });
  if (macOn) await proxy.start();
  for (let i = 0; i < 100 && !agent.egress.listening; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  if (macOn) for (let i = 0; i < 100 && !agent.egress.online(); i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  return {
    agent, proxy, dials, reports, state, port: agent.egress.listening.port,
    async close() {
      agent.stop();
      await running;
      await proxy.close();
      service.close();
      relay.closeAllConnections();
      await Promise.all([new Promise((resolve) => relay.close(resolve)), new Promise((resolve) => site.close(resolve))]);
    },
  };
}

test("a bot computer's socks5 stream opens on this computer and its bytes cross both ways", { timeout: 10_000 }, async () => {
  const target = await fixture();
  try {
    const { socket, reply, read } = await socks(target.port, "site.example", 443);
    assert.equal(reply, 0);
    const payload = Buffer.alloc(300 * 1024, 7);
    socket.write(payload);
    assert.deepEqual(await read(payload.length), payload);
    socket.end();
    assert.deepEqual(target.dials, ["93.184.216.34"]);
    assert.equal(target.reports.at(-1).online, true);
  } finally { await target.close(); }
});

test("http connect works the same way", { timeout: 10_000 }, async () => {
  const target = await fixture();
  try {
    const socket = connect({ port: target.port, host: "127.0.0.1" });
    await once(socket, "connect");
    socket.write("CONNECT site.example:443 HTTP/1.1\r\nhost: site.example:443\r\n\r\nhello");
    let text = "";
    socket.on("data", (chunk) => { text += chunk.toString("latin1"); });
    for (let i = 0; i < 100 && !text.endsWith("hello"); i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(text, "HTTP/1.1 200 Connection Established\r\n\r\nhello");
    socket.destroy();
  } finally { await target.close(); }
});

test("a refused destination fails the request at once, so the browser goes direct for it", { timeout: 10_000 }, async () => {
  const target = await fixture();
  try {
    assert.equal((await socks(target.port, "lan.example", 443)).reply, 2);
    assert.equal((await socks(target.port, "site.example", 22)).reply, 2);
    assert.equal((await socks(target.port, "localhost", 443)).reply, 2);
    assert.deepEqual(target.dials, []);
  } finally { await target.close(); }
});

test("with this computer offline every request fails fast and nothing is dialled", { timeout: 10_000 }, async () => {
  const target = await fixture({ macOn: false });
  try {
    const started = performance.now();
    const { reply } = await socks(target.port, "site.example", 443);
    assert.equal(reply, 1);
    assert.ok(performance.now() - started < 500);
    assert.equal(target.reports.at(-1).online, false);
    assert.deepEqual(target.dials, []);
  } finally { await target.close(); }
});

test("the setting off refuses even with this computer online", { timeout: 10_000 }, async () => {
  const target = await fixture({ enabled: false });
  try {
    assert.equal((await socks(target.port, "site.example", 443)).reply, 1);
    assert.deepEqual(target.dials, []);
  } finally { await target.close(); }
});

test("this computer closing says so, and the vps stops routing through it", { timeout: 10_000 }, async () => {
  const target = await fixture();
  try {
    assert.equal(target.agent.egress.online(), true);
    await target.proxy.close();
    // the goodbye may not leave before the tunnel closes; the unanswered dial then marks it offline
    const { reply } = await socks(target.port, "site.example", 443);
    assert.notEqual(reply, 0);
    assert.equal(target.agent.egress.online(), false);
    const again = performance.now();
    assert.equal((await socks(target.port, "site.example", 443)).reply, 1);
    assert.ok(performance.now() - again < 500);
  } finally { await target.close(); }
});

test("the stream cap refuses past it", { timeout: 10_000 }, async () => {
  const target = await fixture({ endpoint: { maxStreams: 1 } });
  try {
    const first = await socks(target.port, "site.example", 443);
    assert.equal(first.reply, 0);
    assert.equal((await socks(target.port, "site.example", 443)).reply, 1);
    first.socket.destroy();
  } finally { await target.close(); }
});

test("the proxy closes connections from outside the allowed range before reading them", { timeout: 5000 }, async () => {
  const proxy = createEgressProxy({ send: () => {}, bytes: () => true, queued: () => 0, onDrain: () => {}, bind: () => {
    const subnet = new BlockList();
    subnet.addSubnet("127.0.0.0", 8, "ipv4");
    return { host: "127.0.0.1", port: 0, subnet };
  } });
  await proxy.start();
  try {
    const socket = connect({ port: proxy.listening.port, host: "127.0.0.1" });
    socket.on("error", () => {});
    await once(socket, "close");
  } finally { await proxy.stop(); }
});
