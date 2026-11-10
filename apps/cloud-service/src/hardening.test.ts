import { CLOUD_HOME } from "../../../electron/legacy-names.mjs";
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildTemplate, templateName } from "../scripts/build-template.ts";
import { createBoatProvider } from "./boat.ts";
import { startFakeBoatApi } from "./fake-boat-api.ts";
import { boatControlScript, boatSetupScript } from "./home.ts";
import { signRelease, verifyRelease, type ReleaseKey } from "./release-signing.ts";
import { boatFixture } from "./test-fixture.ts";

const MINUTE = 60_000, DAY = 86_400_000;
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function releaseKey(kid = "rel-test"): { signing: string; key: ReleaseKey } {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { signing: `${kid}:${privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url")}`, key: { kid, x: String(createPublicKey(privateKey).export({ format: "jwk" }).x) } };
}

describe("provider limits and conflicts", () => {
  it("a start refused for the pool waits for its nextStartAt: no start before it for any home, no failure, and no stop that would need one", async () => {
    const f = await boatFixture();
    const { c } = await f.paid();
    await f.asleep(c);
    // a second home, up long enough that only the pool can keep it from sleeping
    const other = (await f.paid("acct_2")).c;
    other.powerSince = f.now() - 30 * MINUTE;
    const resumes = () => f.api.requests.filter(r => r.method === "POST" && r.path.endsWith("/resume")).length;
    const notBefore = f.now() + 4 * MINUTE;
    f.api.limitNextStart(notBefore);
    await f.service.power(c.accountId, c.id, "on");
    expect(resumes()).toBe(1);
    f.power.idle = true; f.power.busy = [];
    // however often the service retries, nothing reaches the provider before its time, and nothing counts as a failure
    for (let n = 0; n < 6; n++) {
      f.advance(30_000);
      for (const x of [c, other]) { x.nextAttemptAt = 0; x.managed!.lastPowerAt = 0; }
      await f.service.reconcile();
      expect(resumes()).toBe(1);
      expect(c.attempts).toBe(0);
      // the pool waits for everyone: another home is not stopped while the next start may be refused
      expect(other.status).toBe("running");
    }
    expect(other.managed!.stayReason).toBe("provider_not_before");
    f.advance(notBefore - f.now() + 1_000);
    await f.settle(c, c => c.status === "running");
    expect(resumes()).toBe(2);
  });

  it("a 429 never fails a cloud: it backs off 30 s doubling to 5 minutes, honours Retry-After, and is logged once", async () => {
    const f = await boatFixture();
    const { c } = await f.paid();
    expect(c.status).toBe("running");
    f.power.idle = true; f.power.busy = [];
    f.advance(5 * MINUTE);
    f.api.limitNext(3);
    c.nextAttemptAt = 0; await f.service.reconcile();
    expect(c.status).toBe("running");
    expect(c.error).toBeNull();
    expect(c.attempts).toBe(0);
    // Retry-After: 40 s beats the first 30 s step
    expect(c.nextAttemptAt - f.now()).toBe(40_000);
    for (let n = 0; n < 2; n++) { c.nextAttemptAt = 0; await f.service.reconcile(); }
    expect(c.nextAttemptAt - f.now()).toBe(120_000);
    expect(f.audit.entries(c.id).filter(e => e.action === "provider_limit")).toHaveLength(1);
    await f.settle(c, c => c.status === "sleeping", 60, 5 * 60_000);
    expect(c.managed!.limitStreak).toBe(0);
  });

  it("a 409 on a power change is in progress, not a failure", async () => {
    const f = await boatFixture();
    const { c } = await f.paid();
    const provider = createBoatProvider({ apiKey: f.api.key, baseUrl: f.api.baseUrl, scope: "0123456789abcdef" });
    await provider.power(c.serverId!, "off");
    await provider.power(c.serverId!, "on");
    // resuming already: the fake answers 409 sandbox_resuming
    await expect(provider.power(c.serverId!, "on")).resolves.toBeUndefined();
  });
});

describe("a stop that fails", () => {
  it("is read as stopping: the home is never started again or counted awake, the operator hears after 15 minutes, and nothing is deleted", async () => {
    const f = await boatFixture();
    const { c } = await f.paid();
    f.api.refuseStop(c.serverId!);
    f.power.idle = true; f.power.busy = [];
    // past the rails' minimum uptime
    f.advance(7 * MINUTE);
    c.nextAttemptAt = 0; await f.service.reconcile();
    expect(c.status).toBe("sleeping");
    const starts = () => f.api.requests.filter(r => r.path.endsWith("/commands") && String((r.body as { command: string }).command).includes("omb-home start")).length;
    const before = starts();
    for (let n = 0; n < 4; n++) { f.advance(5 * MINUTE); c.nextAttemptAt = 0; await f.service.reconcile(); }
    expect(starts()).toBe(before);
    expect(c.status).toBe("sleeping");
    expect(f.audit.entries(c.id).map(e => e.action)).toEqual(expect.arrayContaining(["stop_failing", "stop_failing_long"]));
    expect(f.api.deletes()).toEqual([]);
    f.api.refuseStop(c.serverId!, false);
    c.nextAttemptAt = 0; await f.service.reconcile();
    expect(f.audit.entries(c.id).map(e => e.action)).toContain("stop_recovered");
  });
});

describe("keeping stopped disks alive", () => {
  it("wakes the oldest disk first before the 14-day purge, one start per 10 minutes across the deployment", async () => {
    const f = await boatFixture();
    const a = (await f.paid("acct_a")).c;
    f.advance(MINUTE);
    const b = (await f.paid("acct_b")).c;
    f.power.idle = true; f.power.busy = [];
    f.advance(7 * MINUTE);
    // asleep, and the provider has saved each disk (its stop time)
    await f.settle(a, c => c.status === "sleeping" && c.managed!.lastStopAt !== null);
    f.advance(2 * MINUTE);
    await f.settle(b, c => c.status === "sleeping" && c.managed!.lastStopAt !== null);
    const wakes = () => f.audit.entries().filter(e => e.action === "wake" && e.reason === "disk_age").map(e => e.cloudId);
    f.advance(11 * DAY);
    a.nextAttemptAt = 0; b.nextAttemptAt = 0; await f.service.reconcile();
    expect(wakes()).toEqual([a.id]);
    f.advance(5 * MINUTE);
    b.nextAttemptAt = 0; await f.service.reconcile();
    expect(wakes()).toEqual([a.id]);
    f.advance(6 * MINUTE);
    b.nextAttemptAt = 0; await f.service.reconcile();
    expect(wakes()).toEqual([a.id, b.id]);
  });
});

describe("a disk that may not be refreshed never starves the others", () => {
  it("an ended cloud on hold, older than every other, does not keep a sleeping cloud from its refresh", async () => {
    const f = await boatFixture();
    const held = (await f.paid("acct_held")).c;
    f.advance(MINUTE);
    const live = (await f.paid("acct_live")).c;
    f.power.idle = true; f.power.busy = [];
    f.advance(5 * MINUTE);
    await f.settle(held, c => c.status === "sleeping" && c.managed!.lastStopAt !== null);
    f.advance(2 * MINUTE);
    await f.settle(live, c => c.status === "sleeping" && c.managed!.lastStopAt !== null);
    // the held cloud's plan ended and an operator holds it: nothing refreshes or deletes it
    f.subscriptions.find(x => x.cloudId === held.id)!.status = "ended";
    f.subscriptions.find(x => x.cloudId === held.id)!.currentPeriodEnd = f.now();
    f.service.managed!.setHold(held, true);
    f.advance(11 * DAY);
    held.nextAttemptAt = 0; live.nextAttemptAt = 0; await f.service.reconcile();
    expect(f.audit.entries().filter(e => e.action === "wake" && e.reason === "disk_age").map(e => e.cloudId)).toEqual([live.id]);
  });
});

describe("waking for a routine", () => {
  it("starts a sleeping home within the lead and its own spread before its next run, never later", async () => {
    const f = await boatFixture();
    const { c } = await f.paid();
    f.power.idle = true; f.power.busy = []; const due = f.now() + 3 * 3_600_000; f.power.nextDueAt = due;
    f.advance(5 * MINUTE);
    await f.settle(c, c => c.status === "sleeping", 60, 5 * 60_000);
    expect(c.managed!.nextDueAt).toBe(due);
    // the default lead is 4 minutes and the spread 4 more: no wake 9 minutes out, a wake by 4 minutes out
    f.advance(due - 9 * MINUTE - f.now());
    c.nextAttemptAt = 0; await f.service.reconcile();
    expect(f.audit.entries(c.id).some(e => e.action === "wake" && e.reason === "routine_due")).toBe(false);
    for (let at = due - 8 * MINUTE; at <= due - 4 * MINUTE && !f.audit.entries(c.id).some(e => e.action === "wake"); at += 30_000) {
      f.advance(at - f.now()); c.nextAttemptAt = 0; await f.service.reconcile();
    }
    const wake = f.audit.entries(c.id).find(e => e.action === "wake" && e.reason === "routine_due");
    expect(wake).toBeDefined();
    expect(due - wake!.at).toBeGreaterThanOrEqual(4 * MINUTE);
  });
});

describe("the machine's own guards", () => {
  const setup = boatSetupScript(), control = boatControlScript();
  it("the pre-stop hook flags the save, stops the home within 40 s or kills it, and arms a restart if the stop never comes", () => {
    expect(setup).toContain(`sudo -n touch ${CLOUD_HOME.run}/pre-stop`);
    expect(setup).toContain("sudo -n timeout 40 systemctl stop omb-home.service >/dev/null 2>&1 || sudo -n systemctl kill -s KILL omb-home.service");
    expect(setup).toContain("--on-active=15min");
    expect(setup).toContain(`ConditionPathExists=!${CLOUD_HOME.run}/pre-stop`);
    expect(setup).toContain("TimeoutStopSec=35");
    expect(control).toContain("resume-if-cancelled)");
    // starting clears the flag first, so a resume that kept the machine in memory starts the home again
    expect(control.indexOf(`rm -f ${CLOUD_HOME.run}/pre-stop; systemctl stop omb-stop-cancelled.timer`)).toBeLessThan(control.indexOf("systemctl restart omb-home.service"));
  });

  it("caps memory: the home under 90%, bot computers under their slice, compressed swap, and the home killed last", () => {
    for (const line of ["MemoryMax=90%", "OOMScoreAdjust=-500", "OOMPolicy=continue", "MemoryMax=75%", "omb-zram", "cgroup-parent"]) expect(setup).toContain(line);
  });

  it("restarts the home when a flagged stop never came, after five minutes, and leaves a fresh flag alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-prestop-")); dirs.push(dir);
    const branch = control.slice(control.indexOf("  resume-if-cancelled)"), control.indexOf("  start)"));
    const flag = join(dir, "pre-stop"), log = join(dir, "log");
    const script = `set -e\nsystemctl() { echo "systemctl $*" >> ${log}; }\nstat() { if [ "$1" = -c ]; then cat ${dir}/mtime; fi; }\ncase "resume-if-cancelled" in\n${branch.replaceAll(`${CLOUD_HOME.run}/pre-stop`, flag)}\nesac\n`;
    writeFileSync(join(dir, "run.sh"), script);
    writeFileSync(flag, ""); writeFileSync(join(dir, "mtime"), String(Math.floor(Date.now() / 1000) - 60));
    expect(execFileSync("bash", [join(dir, "run.sh")], { encoding: "utf8" }).trim()).toBe("kept");
    writeFileSync(join(dir, "mtime"), String(Math.floor(Date.now() / 1000) - 600));
    expect(execFileSync("bash", [join(dir, "run.sh")], { encoding: "utf8" }).trim()).toBe("resumed");
    expect(execFileSync("cat", [log], { encoding: "utf8" })).toContain("systemctl start omb-home.service");
  });
});

describe("the pre-baked template", () => {
  it("is built from a signed package on a clean builder, signed for its app's tree, saved under the release's name, and keeps the three newest plus the one in use", async () => {
    const api = await startFakeBoatApi();
    try {
      const { signing, key } = releaseKey();
      const pkg = Buffer.from("package bytes"), sha256 = createHash("sha256").update(pkg).digest("hex");
      const signature = signRelease({ kind: "home-package", name: "omb-home", version: "0.1.150", sha256, signedAt: 1 }, signing);
      const tree = "f".repeat(64);
      api.onCommand(({ command }) => command.includes(" install ") && command.includes(signature) ? { exitCode: 0, stdout: "installed\n" }
        : command.includes("echo clean") ? { exitCode: 0, stdout: "clean\n" } : command.includes("omb-home tree") ? { exitCode: 0, stdout: `${tree}\n` }
        : command.includes("echo placed") ? { exitCode: 0, stdout: "placed\n" } : { exitCode: 1, stdout: "" });
      const provider = createBoatProvider({ apiKey: api.key, baseUrl: api.baseUrl, scope: "fedcba9876543210" });
      for (const [name, at] of [["omb-home-0-1-146", 1], ["omb-home-0-1-147", 2], ["omb-home-0-1-148", 3], ["omb-home-0-1-149", 4]] as const) api.named.set(name, { name, status: "ready", createdAt: at, polls: 0 });
      const built = await buildTemplate({ provider, pkg, signature, version: "0.1.150", signingKey: signing, releaseKeys: [key], inUse: ["omb-home-0-1-146"], pollMs: 0 });
      expect(built.name).toBe(templateName("0.1.150"));
      expect(verifyRelease(built.signature, { kind: "template", name: built.name, sha256: tree }, [key]).version).toBe(sha256);
      expect([...api.named.keys()].sort()).toEqual(["omb-home-0-1-146", "omb-home-0-1-148", "omb-home-0-1-149", "omb-home-0-1-150"]);
      expect(api.sandboxes.size).toBe(0);
      const create = api.requests.find(r => r.method === "POST" && r.path === "/sandboxes")!.body as Record<string, unknown>;
      expect(create).toMatchObject({ noEnv: true });
      expect(create.files).toBeUndefined();
      await expect(buildTemplate({ provider, pkg, signature, version: "0.1.150", signingKey: signing, releaseKeys: [key], pollMs: 0 })).rejects.toThrow("exists already");
    } finally { await api.close(); }
  });

  it("a cloud started from a signed template skips installing the package it already carries", async () => {
    const { signing, key } = releaseKey();
    const signature = signRelease({ kind: "template", name: "omb-home-0-1-150", version: "a".repeat(64), sha256: "f".repeat(64), signedAt: 1 }, signing);
    const f = await boatFixture({ settings: { template: "omb-home-0-1-150", templateSignature: signature }, releaseKeys: [key] });
    const { c } = await f.paid();
    expect(c.status).toBe("running");
    const create = f.api.requests.find(r => r.method === "POST" && r.path === "/sandboxes")!.body as Record<string, unknown>;
    expect(create.from).toBe("omb-home-0-1-150");
    expect(f.api.requests.some(r => r.path.endsWith("/commands") && String((r.body as { command: string }).command).includes("omb-home install"))).toBe(false);
  });
});
