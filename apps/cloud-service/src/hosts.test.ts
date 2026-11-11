import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { hostsFromEnv } from "./hosts.ts";
import { managedCloudFromEnv } from "./index.ts";
import { boatFixture, hostsFixture } from "./test-fixture.ts";

it("a Boat-only service writes the records and files it always wrote", async () => {
  const f = await boatFixture();
  const { c } = await f.paid();
  expect(c.managed!.host).toBeUndefined();
  expect(c.serverId).toMatch(/^bx_/);
  const files = readdirSync(f.dataDir);
  expect(files).toEqual(expect.arrayContaining(["provider-starts.json", "spend"]));
  expect(files.some(name => name.includes("instabox"))).toBe(false);
});

it("puts new clouds on the default host, drives each cloud through its own host, and leaves Boat's clouds where they are", async () => {
  const f = await hostsFixture({ defaultHost: "boat" });
  const onBoat = await f.paid("acct_boat");
  expect(onBoat.managed!.host).toBeUndefined();
  expect(onBoat.serverId).toMatch(/^bx_/);
  // people see our domain (required off loopback), never the provider's; the service talks to the machine's own URL
  const g = await hostsFixture({ defaultHost: "instabox", settings: { publicDomain: "desktops.example.test" } });
  const onIbx = await g.paid("acct_ibx");
  expect(onIbx).toMatchObject({ status: "running", managed: { host: "instabox" } });
  expect(onIbx.serverId).toMatch(/^m_[a-z0-9]{26}$/);
  expect(onIbx.origin).toMatch(/^https:\/\/d[0-9a-f]{20}\.desktops\.example\.test$/);
  expect(onIbx.managed!.upstream).toMatch(/^https:\/\/8080-[a-z0-9]+\.instabox\.tech$/);
  expect(g.boatApi.requests.some(r => r.method === "POST")).toBe(false);
  expect(existsSync(join(g.dataDir, "instabox-starts.json"))).toBe(true);
  expect(existsSync(join(g.dataDir, "spend-instabox"))).toBe(true);
  expect(g.service.view(onIbx)).toMatchObject({ provider: "managed", status: "running" });
  expect(JSON.stringify(g.service.view(onIbx)).toLowerCase()).not.toContain("instabox");
});

it("pauses an idle InstaBox home with its memory, after a live backup, and wakes it for its owner where it left off", async () => {
  const f = await hostsFixture({ defaultHost: "instabox" });
  const c = await f.paid();
  const machine = f.ibxApi.machines.get(c.serverId!)!;
  machine.memory.add("a chat open on a bot's screen");
  f.advance(5 * 60_000); f.power.idle = true; f.power.busy = [];
  await f.settle(c, x => x.status === "sleeping", 80, 5 * 60_000);
  expect(machine.state).toBe("suspended");
  expect(c.managed!.backups).toHaveLength(1);
  expect(f.audit.entries(c.id).find(e => e.action === "backup")?.reason).toBe("before_sleep");
  expect(machine.files.has("/data/home/.omb-snapshot.tar")).toBe(false);
  await f.service.power(c.accountId, c.id, "on");
  await f.settle(c, x => x.status === "running");
  expect(machine.memory.has("a chat open on a bot's screen")).toBe(true);
  expect(f.audit.entries(c.id).map(e => e.action)).toEqual(expect.arrayContaining(["sleep", "wake", "awake"]));
  // never paused while it works
  f.power.idle = false; f.power.busy = ["turn"];
  for (let n = 0; n < 10; n++) { f.advance(10 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile(); }
  expect(machine.state).toBe("running");
  expect(c.managed!.stayReason).toBe("busy:turn");
});

it("brings back a lost InstaBox machine from its backup, and wakes one that paused itself only on intent", async () => {
  const f = await hostsFixture({ defaultHost: "instabox", settings: { lostAfterMs: 2 * 60_000 } });
  const c = await f.paid();
  f.advance(5 * 60_000); f.power.idle = true; f.power.busy = [];
  await f.settle(c, x => x.status === "sleeping", 80, 5 * 60_000);
  await f.service.power(c.accountId, c.id, "on");
  await f.settle(c, x => x.status === "running");
  // the dead-man pause (our lease lapsed): asleep to the lifecycle, and woken because the owner wants it on
  f.ibxApi.autoPause(c.serverId!);
  await f.settle(c, x => x.status === "running" && f.ibxApi.machines.get(x.serverId!)!.state === "running");
  const lost = c.serverId!;
  f.ibxApi.lose(lost);
  await f.settle(c, x => x.status === "running" && x.serverId !== lost, 60, 60_000);
  expect(f.volume(c).get("data/.openmausbot/bots.json")).toContain("Test bot");
  expect(f.notices.map(n => n.kind)).toContain("recovered");
});

it("reads which hosts to drive from the environment, and needs only the keys of those it drives", () => {
  expect(hostsFromEnv({})).toEqual({ enabled: ["boat"], fallback: "boat" });
  expect(hostsFromEnv({ DUSK_MANAGED_HOSTS: "boat,instabox" })).toEqual({ enabled: ["boat", "instabox"], fallback: "boat" });
  expect(() => hostsFromEnv({ DUSK_MANAGED_HOSTS: "boat", DUSK_MANAGED_HOST: "instabox" })).toThrow("DUSK_MANAGED_HOST");
  expect(() => hostsFromEnv({ DUSK_MANAGED_HOSTS: "boat,elsewhere" })).toThrow("DUSK_MANAGED_HOSTS");
  const base = { DUSK_MANAGED: "1", DUSK_MANAGED_HOME_PACKAGE_URL: "https://packages.example.test/home.tgz", DUSK_MANAGED_HOME_PACKAGE_SHA256: "a".repeat(64) };
  const options = { dataDir: "/tmp/never-written", publicUrl: "http://127.0.0.1:9", loopback: true, sealKey: Buffer.alloc(32, 1), now: Date.now, subscriptions: () => [] };
  expect(() => managedCloudFromEnv({ ...base }, options)).toThrow("BOAT_API_KEY");
  expect(() => managedCloudFromEnv({ ...base, DUSK_MANAGED_HOSTS: "instabox", DUSK_MANAGED_HOST: "instabox" }, options)).toThrow("INSTABOX_API_KEY");
  expect(managedCloudFromEnv({ ...base, DUSK_MANAGED_HOSTS: "instabox", DUSK_MANAGED_HOST: "instabox", INSTABOX_API_KEY: `ibk_${"k".repeat(52)}` }, options)?.kinds).toBeTruthy();
  expect(() => managedCloudFromEnv({ ...base, DUSK_MANAGED_HOSTS: "instabox", DUSK_MANAGED_HOST: "instabox", INSTABOX_API_KEY: `ibk_${"k".repeat(52)}`, DUSK_MANAGED_INSTABOX_IDLE_PAUSE_MINUTES: "2" }, options)).toThrow("idle pause");
});
