import { expect, it } from "vitest";
import type { StoredCloud } from "../../dashboard/server/clouds/types.ts";
import { hostsFixture } from "./test-fixture.ts";

const phase = (c: StoredCloud) => c.managed!.migration?.phase ?? null;
const SETTINGS = { publicDomain: "desktops.example.test" };

it("moves a Boat home to InstaBox: quiet first, verified backup, checked file by file, same address, Boat machine kept until finish", async () => {
  const f = await hostsFixture({ defaultHost: "boat", settings: SETTINGS });
  const c = await f.paid();
  const origin = c.origin, boatId = c.serverId!;
  const before = f.volume(c);
  // a turn is running: the move waits for a quiet moment
  f.power.idle = false; f.power.busy = ["turn"];
  f.managed.migrate!(c, "instabox");
  await f.settle(c, x => x.managed!.migration!.waitingFor?.includes("turn") === true, 5);
  expect(f.boatApi.sandboxes.get(boatId)!.state).toBe("ready");
  f.power.idle = true; f.power.busy = [];
  await f.settle(c, x => phase(x) === "done", 60, 15_000);
  expect(c).toMatchObject({ status: "running", origin, managed: { host: "instabox" } });
  expect(c.serverId).toMatch(/^m_/);
  expect(c.managed!.migration!.checked).toMatchObject({ mismatched: 0 });
  expect(c.managed!.migration!.checked!.files).toBeGreaterThanOrEqual(3);
  const after = f.volume(c);
  for (const [path, data] of before) if (!path.endsWith("dashboard-link.json")) expect(after.get(path), path).toBe(data);
  expect(f.boatApi.sandboxes.get(boatId)!.state).toBe("archived");
  expect(f.notices.map(n => n.kind)).not.toContain("recovered");
  // the sweep leaves the machine the home left alone while the move is open
  f.advance(31 * 60_000); c.nextAttemptAt = 0; await f.service.reconcile();
  expect(f.boatApi.sandboxes.has(boatId)).toBe(true);
  await f.managed.finishMigration!(c);
  expect(phase(c)).toBe("finished");
  expect(f.boatApi.sandboxes.has(boatId)).toBe(false);
  expect(f.audit.entries(c.id).map(e => e.action)).toEqual(expect.arrayContaining(["migration_started", "migration_quiesced", "migration_copying", "migration_checked", "migration_done", "migration_left_deleted"]));
});

it("moves an InstaBox home to Boat and rolls it back on purpose, keeping what it did on Boat", async () => {
  const f = await hostsFixture({ defaultHost: "instabox", settings: SETTINGS });
  const c = await f.paid();
  const ibxId = c.serverId!;
  f.ibxApi.machines.get(ibxId)!.memory.add("kept for the rollback");
  f.power.idle = true; f.power.busy = [];
  f.managed.migrate!(c, "boat");
  await f.settle(c, x => phase(x) === "done", 60, 15_000);
  expect(c.serverId).toMatch(/^bx_/);
  expect(c.managed!.host).toBe("boat");
  expect(f.ibxApi.machines.get(ibxId)!.state).toBe("suspended");
  // the home works on Boat after the cut-over
  const boatId = c.serverId!;
  f.boatApi.sandboxes.get(boatId)!.volume.set("__system__/data/.openmausbot/routines.json", Buffer.from("[\"made on boat\"]"));
  f.managed.rollbackMigration!(c);
  await f.settle(c, x => phase(x) === "rolled_back" && x.status === "running", 60, 15_000);
  expect(c.serverId).toBe(ibxId);
  expect(c.managed!.host).toBe("instabox");
  // resumed in memory, not rebuilt
  expect(f.ibxApi.machines.get(ibxId)!.memory.has("kept for the rollback")).toBe(true);
  // Boat's machine is asleep and kept; its state since the cut-over is a kept backup generation
  expect(f.boatApi.sandboxes.get(boatId)!.state).toBe("archived");
  const kept = c.managed!.backups.find(g => g.keep && g.source === boatId);
  expect(kept).toBeTruthy();
  expect(f.backups.read(c.id, (await import("./backups.ts")).homeBackupKey(Buffer.alloc(32, 9), c.id), kept!.file).includes("made on boat")).toBe(true);
  await f.managed.finishMigration!(c);
  expect(f.boatApi.sandboxes.has(boatId)).toBe(false);
  expect(f.ibxApi.machines.has(ibxId)).toBe(true);
});

it("rolls back by itself when the new machine's files do not match the backup, before its home ever starts", async () => {
  const f = await hostsFixture({ defaultHost: "boat", settings: SETTINGS });
  const c = await f.paid();
  const boatId = c.serverId!;
  f.ibxApi.onExec(({ machine, cmd }) => {
    // a restore that loses a browser profile on the way
    if (cmd.includes("omb-home restore")) { const tar = machine.files.get("/data/home/omb-restore.tar")!; machine.files.delete("/data/home/omb-restore.tar"); machine.volume = new Map([["data/.omb-cloud-home.json", Buffer.from(JSON.stringify({ version: 1, machine: c.id }))]]); return tar ? { exitCode: 0, stdout: "restored\n" } : null; }
    return null;
  });
  f.power.idle = true; f.power.busy = [];
  f.managed.migrate!(c, "instabox");
  await f.settle(c, x => phase(x) === "rolled_back" && x.status === "running", 60, 15_000);
  expect(c.serverId).toBe(boatId);
  expect(c.managed!.host).toBeUndefined();
  expect(c.managed!.migration!.error).toMatch(/^files_differ:\d+$/);
  const target = c.managed!.migration!.target!;
  expect(target.host).toBe("instabox");
  expect(f.ibxApi.machines.get(target.serverId)!.state).not.toBe("running");
  expect(f.ibxApi.requests.some(r => r.path.endsWith("/exec") && String((r.body as { cmd: string }).cmd).includes("omb-home start"))).toBe(false);
});

it("rolls back at once when the target provider refuses to create (an account that cannot), and resumes the paused home", async () => {
  const f = await hostsFixture({ defaultHost: "instabox", settings: SETTINGS });
  const c = await f.paid();
  const ibxId = c.serverId!;
  f.ibxApi.machines.get(ibxId)!.memory.add("still here");
  f.boatApi.refuseCreates("subscription_required");
  f.power.idle = true; f.power.busy = [];
  f.managed.migrate!(c, "boat");
  await f.settle(c, x => phase(x) === "rolled_back" && x.status === "running", 40, 15_000);
  expect(c.managed!.migration!.error).toBe("target_refused:subscription_required");
  expect(c).toMatchObject({ serverId: ibxId, managed: { host: "instabox" } });
  expect(f.ibxApi.machines.get(ibxId)!.memory.has("still here")).toBe(true);
  expect(f.boatApi.sandboxes.size).toBe(0);
});

it("refuses a move that cannot be made safely, and a quiescing move can be cancelled with nothing changed", async () => {
  const f = await hostsFixture({ defaultHost: "boat", settings: SETTINGS });
  const c = await f.paid();
  expect(() => f.managed.migrate!(c, "boat")).toThrow("already_there");
  c.managed!.retired.push({ serverId: "bx_23456789", at: f.now(), deletion: null });
  expect(() => f.managed.migrate!(c, "instabox")).toThrow("retired_machines_open");
  c.managed!.retired = [];
  f.power.idle = false; f.power.busy = ["run"];
  f.managed.migrate!(c, "instabox");
  expect(() => f.managed.migrate!(c, "instabox")).toThrow("migration_open");
  await f.settle(c, x => x.managed!.migration!.waitingFor?.includes("run") === true, 5);
  f.managed.rollbackMigration!(c);
  expect(c.managed!.migration).toMatchObject({ phase: "finished", error: "cancelled" });
  expect(c.serverId).toMatch(/^bx_/);
  expect(f.ibxApi.machines.size).toBe(0);
  await expect(f.managed.finishMigration!(c)).rejects.toThrow("not_finishable");
});
