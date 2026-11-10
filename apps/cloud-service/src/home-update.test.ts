import { CLOUD_HOME } from "../../../electron/legacy-names.mjs";
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boatControlScript } from "./home.ts";
import type { HomeRelease } from "./home-update.ts";
import { signRelease, type ReleaseKey } from "./release-signing.ts";
import { createPolicySource, signPolicy, verifyPolicy } from "./update-policy.ts";
import { boatFixture, cleanup } from "./test-fixture.ts";
import type { StoredCloud } from "../../dashboard/server/clouds/types.ts";

const { privateKey } = generateKeyPairSync("ed25519");
const signing = `test-rel:${privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url")}`;
const keys: ReleaseKey[] = [{ kid: "test-rel", x: createPublicKey(privateKey).export({ format: "jwk" }).x! }];
const sha = (v: string) => createHash("sha256").update(`pkg-${v}`).digest("hex");
const release = (version: string): HomeRelease => ({ sha256: sha(version), url: `https://packages.example.test/${version}.tgz`,
  signature: signRelease({ kind: "home-package", name: "omb-home", version, sha256: sha(version), signedAt: 1 }, signing) });

async function updating(options: { policy?: { serial: number; floor: string | null; blocked: string[] } } = {}) {
  let offered: HomeRelease | null = null;
  const dir = mkdtempSync(join(tmpdir(), "dusk-policy-")); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const policyFile = join(dir, "policy.json");
  if (options.policy) writeFileSync(policyFile, JSON.stringify(signPolicy(options.policy, signing)));
  const f = await boatFixture({ releaseKeys: keys, settings: { package: release("1.0.0") }, release: () => offered, updatePolicy: createPolicySource(policyFile, keys, () => {}) });
  const { c } = await f.paid();
  const commands = () => f.api.requests.filter(r => r.path.endsWith("/commands")).map(r => (r.body as { command: string }).command);
  const actions = () => f.audit.entries(c.id).filter(e => e.action.startsWith("update_") && e.action !== "update_policy").map(e => `${e.action}:${e.reason}`);
  /** one reconcile with the home's power read due */
  const pass = async () => { f.advance(61_000); c.nextAttemptAt = 0; await f.service.reconcile(); };
  return { f, c, commands, actions, pass, offer: (r: HomeRelease | null) => { offered = r; }, policyFile,
    setPolicy: (p: { serial: number; floor: string | null; blocked: string[] }) => { writeFileSync(policyFile, JSON.stringify(signPolicy(p, signing))); } };
}
const version = (c: StoredCloud) => c.managed!.update?.guard.current?.version ?? null;

describe("staged home updates", () => {
  it("installs a newer signed release only while the home is idle, self-tests it and settles after two runs", async () => {
    const t = await updating();
    expect(version(t.c) ?? "1.0.0").toBe("1.0.0");
    t.offer(release("1.1.0"));
    t.f.power.busy = ["turn"];
    await t.pass();
    expect(t.commands().filter(x => x.includes("omb-home install"))).toHaveLength(1);
    t.f.power.busy = ["run"]; await t.pass();
    t.f.power.busy = ["maintenance"]; await t.pass();
    expect(t.c.managed!.update!.guard.trial).toBeNull();
    t.f.power.busy = ["recent-activity"];
    await t.pass();
    const install = t.commands().filter(x => x.includes("omb-home install")).at(-1)!;
    expect(install).toContain(sha("1.1.0"));
    expect(install).toContain(release("1.1.0").signature!);
    expect(t.c.managed!.installed).toBe(sha("1.1.0"));
    expect(t.c.managed!.update!.guard.trial).toMatchObject({ to: { version: "1.1.0" }, selfTest: "pending" });
    // the self-test still runs: the home is kept up, never put to sleep in the middle
    t.f.power.idle = true; t.f.power.busy = [];
    Object.assign(t.f.update, { version: "1.1.0", selfTest: "running" });
    await t.pass();
    expect(t.c.status).toBe("running");
    const at = t.f.now();
    Object.assign(t.f.update, { selfTest: "passed", runs: [{ id: "r1", ok: true, at }, { id: "r2", ok: false, at: at + 1 }] });
    await t.pass();
    expect(t.c.managed!.update!.guard.trial).toBeNull();
    expect(t.c.managed!.update!.guard.last).toMatchObject({ kind: "updated", version: "1.1.0" });
    expect(t.actions()).toEqual(["update_applied:idle", "update_settled:trial_passed"]);
  });

  it("rolls back automatically when the self-test fails, and never installs that version again", async () => {
    const t = await updating();
    t.offer(release("1.1.0"));
    await t.pass();
    Object.assign(t.f.update, { version: "1.1.0", selfTest: "failed" });
    await t.pass();
    expect(t.commands().some(x => x.includes("omb-home rollback"))).toBe(true);
    expect(t.commands().at(-1)).toContain("omb-home start");
    expect(t.c.managed!.installed).toBe(sha("1.0.0"));
    expect(version(t.c)).toBe("1.0.0");
    expect(t.actions()).toEqual(["update_applied:idle", "update_rolled_back:self_test"]);
    const installs = t.commands().filter(x => x.includes("omb-home install")).length;
    Object.assign(t.f.update, { version: "1.0.0", selfTest: "passed" });
    await t.pass(); await t.pass();
    expect(t.commands().filter(x => x.includes("omb-home install")).length).toBe(installs);
    expect(t.actions().at(-1)).toBe("update_refused:failed_here");
  });

  it("rolls back when the new version does not answer within the self-test window", async () => {
    const t = await updating();
    t.offer(release("1.1.0"));
    await t.pass();
    t.f.home.update.mockRejectedValue(new Error("down"));
    await t.pass();
    expect(t.c.managed!.update!.guard.trial).not.toBeNull();
    t.f.advance(5 * 60_000);
    await t.pass();
    expect(t.actions()).toContain("update_rolled_back:self_test");
  });

  it("rolls back when the next two runs fail in a row, once the home is idle", async () => {
    const t = await updating();
    t.offer(release("1.1.0"));
    await t.pass();
    const at = t.f.now();
    Object.assign(t.f.update, { version: "1.1.0", selfTest: "passed", runs: [{ id: "a", ok: false, at }, { id: "b", ok: false, at: at + 1 }] });
    t.f.power.busy = ["run"];
    await t.pass();
    expect(t.c.managed!.installed).toBe(sha("1.1.0"));
    t.f.power.busy = [];
    await t.pass();
    expect(t.c.managed!.installed).toBe(sha("1.0.0"));
    expect(t.actions().at(-1)).toBe("update_rolled_back:runs_failed");
    expect(t.f.audit.entries(t.c.id).find(e => e.action === "update_rolled_back")!.detail).toMatchObject({ from: "1.1.0", to: "1.0.0", rerunFree: 2 });
  });

  it("never installs a blocked version, and rolls a running one back when it is blocked later", async () => {
    const t = await updating({ policy: { serial: 1, floor: null, blocked: ["1.1.0"] } });
    t.offer(release("1.1.0"));
    await t.pass();
    expect(t.commands().some(x => x.includes(sha("1.1.0")))).toBe(false);
    expect(t.actions()).toContain("update_refused:blocked");
    // 1.2.0 goes in and settles; then the operator pulls it
    t.offer(release("1.2.0"));
    await t.pass();
    Object.assign(t.f.update, { version: "1.2.0", selfTest: "passed" });
    t.f.advance(25 * 3_600_000); await t.pass();
    expect(t.c.managed!.update!.guard.last).toMatchObject({ kind: "updated", version: "1.2.0" });
    t.setPolicy({ serial: 2, floor: null, blocked: ["1.1.0", "1.2.0"] });
    await t.pass();
    expect(t.actions().at(-1)).toBe("update_rolled_back:blocked");
    expect(t.c.managed!.installed).toBe(sha("1.0.0"));
  });

  it("refuses a downgrade and anything below the signed floor, and passes the floor to the machine", async () => {
    const t = await updating({ policy: { serial: 1, floor: "1.0.0", blocked: [] } });
    t.offer(release("0.9.0"));
    await t.pass();
    expect(t.actions()).toEqual(["update_refused:below_floor"]);
    t.setPolicy({ serial: 2, floor: null, blocked: [] });
    await t.pass();
    expect(t.actions().at(-1)).toBe("update_refused:not_newer");
    expect(t.commands().filter(x => x.includes("omb-home install"))).toHaveLength(1);
    // an unsigned release is never installed where releases must be signed
    t.setPolicy({ serial: 3, floor: "1.0.0", blocked: [] });
    t.offer({ ...release("2.0.0"), signature: undefined });
    await t.pass();
    expect(t.actions().at(-1)).toBe("update_refused:invalid");
    t.offer(release("2.0.0"));
    await t.pass();
    expect(t.commands().at(-2)).toMatch(/omb-home install \S+ [a-f0-9]{64} r1\.\S+ 1\.0\.0$/);
  });

  it("serves only a policy the pinned keys signed, and keeps the last good one", () => {
    const dir = mkdtempSync(join(tmpdir(), "dusk-policy-")); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "p.json"), alerts: string[] = [];
    writeFileSync(file, JSON.stringify(signPolicy({ serial: 4, floor: "1.0.0", blocked: [] }, signing)));
    const source = createPolicySource(file, keys, line => alerts.push(line));
    expect(source.policy()).toEqual({ serial: 4, floor: "1.0.0", blocked: [] });
    const signed = source.signed()!;
    writeFileSync(file, JSON.stringify({ ...signed, body: signed.body.replace("1.0.0", "0.0.1") }));
    expect(source.policy()?.floor).toBe("1.0.0");
    expect(alerts).toHaveLength(1);
    expect(() => verifyPolicy({ ...signed, body: signed.body.replace("1.0.0", "0.0.1") }, keys)).toThrow();
  });
});

describe("omb-home on the machine", () => {
  // the real control script, its root paths moved into a temp folder and root-only commands stubbed
  function machine() {
    const dir = mkdtempSync(join(tmpdir(), "dusk-machine-")); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const bin = join(dir, "stub"); mkdirSync(bin);
    for (const name of ["systemctl", "chown"]) { writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n"); chmodSync(join(bin, name), 0o755); }
    writeFileSync(join(bin, "install"), "#!/bin/sh\nwhile [ $# -gt 1 ]; do case \"$1\" in -d) ;; -o|-g|-m) shift ;; *) mkdir -p \"$1\" ;; esac; shift; done\n[ -z \"$1\" ] || mkdir -p \"$1\"\n");
    chmodSync(join(bin, "install"), 0o755);
    // macOS has no gnu sha256sum
    if (process.platform === "darwin") { writeFileSync(join(bin, "sha256sum"), "#!/bin/sh\nexec shasum -a 256 \"$@\"\n"); chmodSync(join(bin, "sha256sum"), 0o755); }
    const script = boatControlScript({ releaseKeys: keys, requireSigned: true }).replaceAll(CLOUD_HOME.root, join(dir, "root")).replaceAll(`${join(dir, "root")}/node/bin/node`, process.execPath);
    writeFileSync(join(dir, "omb-home"), script); mkdirSync(join(dir, "root"), { recursive: true });
    const pkg = (v: string) => {
      const stage = join(dir, `stage-${v}`); mkdirSync(join(stage, "dist-server"), { recursive: true });
      writeFileSync(join(stage, "dist-server", "cloud-home-start.js"), `// ${v}\n`);
      const file = join(dir, `pkg-${v}.tgz`); execFileSync("tar", ["-czf", file, "-C", stage, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
      const sum = createHash("sha256").update(readFileSync(file)).digest("hex");
      return { file, sum, sig: signRelease({ kind: "home-package", name: "omb-home", version: v, sha256: sum, signedAt: 1 }, signing) };
    };
    const run = (...args: string[]) => {
      try { return execFileSync("bash", [join(dir, "omb-home"), ...args], { encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: dir } }).trim(); }
      catch (error) { return String((error as { stdout?: string }).stdout ?? "").trim().split("\n").at(-1)!; }
    };
    const running = () => readFileSync(join(dir, "root", "app", "dist-server", "cloud-home-start.js"), "utf8").trim();
    return { dir, pkg, run, running };
  }

  it("installs a newer signed package, refuses an older one or one below the floor, and rolls back to the one before", () => {
    const m = machine();
    const v1 = m.pkg("1.0.0"), v2 = m.pkg("1.1.0");
    expect(m.run("install", v1.file, v1.sum, v1.sig)).toBe("installed");
    expect(m.run("install", v2.file, v2.sum, v2.sig, "1.0.0")).toBe("installed");
    expect(m.running()).toBe("// 1.1.0");
    const old = m.pkg("1.0.0");
    expect(m.run("install", old.file, old.sum, old.sig)).toBe("older package");
    const v3 = m.pkg("1.2.0");
    expect(m.run("install", v3.file, v3.sum, v3.sig, "1.3.0")).toBe("below floor");
    const again = m.pkg("1.1.1");
    expect(m.run("install", again.file, again.sum, "r1.bad.x.y")).toBe("bad signature");
    expect(m.running()).toBe("// 1.1.0");
    expect(m.run("rollback")).toBe("rolled back");
    expect(m.running()).toBe("// 1.0.0");
    expect(readFileSync(join(m.dir, "root", "installed-version"), "utf8").trim()).toBe("1.0.0");
    expect(readFileSync(join(m.dir, "root", "installed"), "utf8").trim()).toBe(v1.sum);
    expect(m.run("rollback")).toBe("nothing to roll back to");
    expect(existsSync(join(m.dir, "root", "app.prev"))).toBe(false);
  });
});
