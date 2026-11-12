import { execFile } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { signRelease } from "../../cloud-service/src/release-signing.ts";

const run = promisify(execFile);
const script = (await readFile(new URL("../install.sh", import.meta.url), "utf8")).replace(/\nmain "\$@"\s*$/, "\n");
const { privateKey } = generateKeyPairSync("ed25519");
const signing = `test-vps:${privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url")}`;
const publicKey = `test-vps:${createPublicKey(privateKey).export({ format: "jwk" }).x}`;
const dirs = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

const bytesOf = (version) => `v=${version}`;
const shaOf = (version) => createHash("sha256").update(bytesOf(version)).digest("hex");
const sig = (version, sha = shaOf(version)) => signRelease({ kind: "vps-package", name: "duskbot", version, sha256: sha, signedAt: 1 }, signing);

/**
 * a linked server on `installed`, with the link agent's staged build `staged` (its ready.json and tgz) and the server
 * answering the busy read as `server` ("idle", "busy" or "down"); runs root's `--update-server` once
 */
async function updateRound({ installed = "1.0.0", staged = "1.1.0", ready = {}, tgz = bytesOf(staged), server = "idle", selfTest = { version: staged, ok: true, at: 1, checks: {} }, state = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "omb-server-update-")); dirs.push(dir);
  const home = join(dir, "home"), stateDir = join(dir, "state"), data = join(home, ".duskbot"), release = join(dir, "release"), cache = join(home, ".cache/duskbot-link");
  for (const path of [join(home, ".local/lib/node_modules/duskbot"), join(home, ".local/bin"), stateDir, data, release, cache]) await mkdir(path, { recursive: true });
  await writeFile(join(home, ".local/lib/node_modules/duskbot/package.json"), `{\n  "version": "${installed}"\n}\n`);
  await writeFile(join(home, ".local/bin/duskbot"), "#!/bin/sh\n", { mode: 0o755 });
  await writeFile(join(cache, `duskbot-${shaOf(installed)}.tgz`), bytesOf(installed));
  for (const [key, value] of Object.entries({ linked: "abcdefghij", id: "abcdefghij", package: `sha256:${shaOf(installed)}`, "running-package": `sha256:${shaOf(installed)}`, ...state })) {
    await writeFile(join(stateDir, key), `${value}\n`);
  }
  if (selfTest) await writeFile(join(data, "update-state.json"), JSON.stringify({ v: 1, boots: [], selfTest }));
  const sha = shaOf(staged);
  await writeFile(join(release, `${sha}.tgz`), tgz);
  await writeFile(join(release, "ready.json"), JSON.stringify({ v: 1, sha256: sha, size: tgz.length, version: staged, signature: sig(staged), at: 1, ...ready }));
  const file = join(dir, "fixture.sh");
  await writeFile(file, `${script}
SVC_HOME=${home} STATE=${stateDir} DATA=${data} SERVER_RELEASE=${release} INSTALL_LOCK=${join(dir, "lock")} NODE_BIN=${process.execPath} SELFTEST_WAIT=2 UPDATER=${join(dir, "updater.sh")}
log=${join(dir, "log")}
id() { echo 0; }
get_package() { :; }
as_user() { printf 'as_user %s\\n' "$*" >> "$log"; eval "f=\\\${$#}"; v=$(sed -n 's/^v=//p' "$f" 2>/dev/null); [ -z "$v" ] || printf '{\\n  "version": "%s"\\n}\\n' "$v" > "$SVC_HOME/.local/lib/node_modules/duskbot/package.json"; }
retry() { "$@"; }
chown() { :; }
install() { while [ $# -gt 1 ]; do shift; done; mkdir -p "$1"; }
x() { printf 'x %s\\n' "$*" >> "$log"; }
wait_health() { return 0; }
sleep() { :; }
curl() {
  while [ $# -gt 0 ]; do [ "$1" = -o ] && { shift; out=$1; }; shift; done
  case "${server}" in
    down) printf 000; return 7 ;;
    busy) printf '{"busy":["turn"]}' > "$out"; printf 200 ;;
    *) printf '{"busy":[]}' > "$out"; printf 200 ;;
  esac
}
update_server
`);
  const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", TERM: "dumb", DUSK_RELEASE_PUBLIC_KEYS: publicKey };
  const out = await run("sh", [file], { env }).then(r => r.stdout, e => `${e.stdout}\n${e.stderr}\nexit ${e.code}`);
  const read = async (name) => (await readFile(join(stateDir, name), "utf8").catch(() => "")).trim();
  const log = (await readFile(join(dir, "log"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
  return { out, log, read, npm: log.filter(l => l.startsWith("as_user npm install")) };
}

describe("root's server update (install.sh --update-server)", () => {
  it("installs a newer signed staged build while nothing runs, restarts, and settles once its self-test passes", async () => {
    const r = await updateRound();
    expect(r.npm).toHaveLength(1);
    expect(r.npm[0]).toContain(`duskbot-${shaOf("1.1.0")}.tgz`);
    expect(r.log).toContain("x systemctl restart duskbot.service");
    expect(r.out).toContain("Updated to 1.1.0");
    expect(await r.read("package")).toBe(`sha256:${shaOf("1.1.0")}`);
    expect(await r.read("running-package")).toBe(`sha256:${shaOf("1.1.0")}`);
    expect(await r.read("update-pending")).toBe("");
  });

  it("waits while a bot is working, and touches nothing", async () => {
    const r = await updateRound({ server: "busy" });
    expect(r.out).toContain("waits: turn");
    expect(r.npm).toHaveLength(0);
    expect(r.log).not.toContain("x systemctl restart duskbot.service");
    expect(await r.read("package")).toBe(`sha256:${shaOf("1.0.0")}`);
  });

  it("goes ahead when the server does not answer at all: nothing runs there to cut short", async () => {
    const r = await updateRound({ server: "down" });
    expect(r.npm).toHaveLength(1);
    expect(await r.read("package")).toBe(`sha256:${shaOf("1.1.0")}`);
  });

  it("puts the build before back when the new one fails its self-test, and never offers that build to npm again", async () => {
    const r = await updateRound({ selfTest: { version: "1.1.0", ok: false, at: 1, checks: { browser: "failed" } } });
    expect(r.out).toContain("Update rolled back, nothing lost");
    expect(r.npm.at(-1)).toContain(`duskbot-${shaOf("1.0.0")}.tgz`);
    expect(await r.read("package")).toBe(`sha256:${shaOf("1.0.0")}`);
    expect(await r.read("running-package")).toBe(`sha256:${shaOf("1.0.0")}`);
    expect(await r.read("update-failed")).toBe("1.1.0");
  });

  it("refuses a staged build with a forged signature or one that does not match its hash", async () => {
    const forged = await updateRound({ ready: { signature: sig("1.1.0", "c".repeat(64)) } });
    expect(forged.out).toContain("not taken (unsigned)");
    expect(await forged.read("server-update-refused")).toBe(shaOf("1.1.0"));
    const swapped = await updateRound({ tgz: "v=6.6.6" });
    expect(swapped.out).toContain("does not match its hash");
    for (const r of [forged, swapped]) {
      expect(r.npm).toHaveLength(0);
      expect(await r.read("package")).toBe(`sha256:${shaOf("1.0.0")}`);
    }
  });

  it("refuses an older staged build, and does nothing for the build already running", async () => {
    const older = await updateRound({ installed: "2.0.0", staged: "1.9.0" });
    expect(older.out).toContain("not taken (older 1.9.0)");
    expect(older.npm).toHaveLength(0);
    const same = await updateRound({ staged: "1.0.0" });
    expect(same.npm).toHaveLength(0);
    expect(same.log).toHaveLength(0);
  });

  it("refuses to read a staged offer whose fields would reach the shell", async () => {
    const r = await updateRound({ ready: { version: "1.1.0; touch /tmp/pwned", signature: "$(id)" } });
    // the version and signature fall away as unreadable: the build is unsigned here, and the version comes only from a signature
    expect(r.out).not.toContain("pwned");
    expect(r.npm.every(l => !l.includes("$(id)"))).toBe(true);
  });
});
