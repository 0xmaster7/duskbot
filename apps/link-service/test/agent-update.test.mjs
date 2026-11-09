// the link agent keeping itself current: only a verified, newer release is staged, it applies only when the link is
// idle (or when the person asks), and the installed file launches it only while it keeps starting
import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AGENT_VERSION, LINK_PROTOCOL, compareVersions, createTunnelAgent, createUpdater, launchRelease, releaseOf, sealFrame, stagedRelease } from "../agent.mjs";
import { signRelease } from "../release.mjs";
import { createLinkService } from "../src/app.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const agentText = readFileSync(`${root}agent.mjs`, "utf8");
const bumped = (version, protocol = LINK_PROTOCOL) => agentText
  .replace(/^export const AGENT_VERSION = "[^"]+";$/m, `export const AGENT_VERSION = "${version}";`)
  .replace(/^export const LINK_PROTOCOL = \d+;$/m, `export const LINK_PROTOCOL = ${protocol};`);
const sha = (text) => createHash("sha256").update(text).digest("hex");
const NEXT = "9.0.0";

/** the link service's two answers an update reads, from text the test chooses */
function service({ text = bumped(NEXT), manifest = null } = {}) {
  const asked = [];
  const release = manifest ?? { v: 1, agent: { ...releaseOf(text), sha256: sha(text) } };
  const fetchImpl = async (url) => {
    asked.push(new URL(url).pathname);
    if (url.endsWith("/v1/release")) return Response.json(release);
    if (url.endsWith("/agent.mjs")) return new Response(text);
    return new Response("{}", { status: 404 });
  };
  return { fetchImpl, asked, release };
}

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "omb-releases-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("versions", () => {
  it("compare as numbers, and a release says its own", () => {
    expect(compareVersions("2.10.0", "2.9.9")).toBe(1);
    expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
    expect(compareVersions("garbage", "1.0.0")).toBe(-1);
    expect(releaseOf(bumped("3.1.4", 7))).toEqual({ version: "3.1.4", protocol: 7 });
    expect(releaseOf(agentText)).toEqual({ version: AGENT_VERSION, protocol: LINK_PROTOCOL });
  });
});

describe("staging", () => {
  it("a newer release is checked, proven to start, and staged with its marker written last", async () => {
    const link = service();
    const updater = createUpdater({ base: "https://link.test", dir, fetchImpl: link.fetchImpl, keys: [] });
    expect(await updater.check()).toBe(NEXT);
    expect(readFileSync(join(dir, NEXT, "agent.mjs"), "utf8")).toBe(bumped(NEXT));
    expect(JSON.parse(readFileSync(join(dir, "ready.json"), "utf8"))).toMatchObject({ version: NEXT, sha256: sha(bumped(NEXT)) });
    expect(updater.status()).toMatchObject({ running: AGENT_VERSION, staged: NEXT });
    expect(link.asked).toEqual(["/v1/release", "/agent.mjs"]);
  }, 30_000);

  it("never an older release, the same one, or a lower protocol", async () => {
    for (const text of [bumped("1.0.0"), bumped(AGENT_VERSION), bumped(NEXT, LINK_PROTOCOL - 1)]) {
      const link = service({ text });
      const updater = createUpdater({ base: "https://link.test", dir, fetchImpl: link.fetchImpl, keys: [], prove: async () => true });
      expect(await updater.check()).toBe(null);
      expect(link.asked).toEqual(["/v1/release"]);
    }
    expect(existsSync(join(dir, "ready.json"))).toBe(false);
  });

  it("refuses a file that does not match its hash, says another version, or does not start", async () => {
    const cases = [
      service({ text: bumped(NEXT), manifest: { v: 1, agent: { version: NEXT, protocol: LINK_PROTOCOL, sha256: sha("something else") } } }),
      service({ text: bumped("9.0.1"), manifest: { v: 1, agent: { version: NEXT, protocol: LINK_PROTOCOL, sha256: sha(bumped("9.0.1")) } } }),
      service({ text: `${bumped(NEXT)}\nthis is not javascript(` }),
    ];
    const errors = [];
    for (const link of cases) {
      const updater = createUpdater({ base: "https://link.test", dir, fetchImpl: link.fetchImpl, keys: [], log: (line) => errors.push(line) });
      expect(await updater.check()).toBe(null);
    }
    expect(errors.join("\n")).toMatch(/does not match its hash[\s\S]*says it is 9\.0\.1[\s\S]*did not start/);
    expect(existsSync(join(dir, "ready.json"))).toBe(false);
    expect(existsSync(join(dir, NEXT))).toBe(false);
  }, 30_000);

  it("with release keys pinned, only a release signed by one of them", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pinned = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
    const text = bumped(NEXT);
    const unsigned = service({ text });
    const refused = createUpdater({ base: "https://link.test", dir, fetchImpl: unsigned.fetchImpl, keys: [pinned], prove: async () => true });
    expect(await refused.check()).toBe(null);
    expect(refused.status().error).toMatch(/not signed by a pinned key/);
    const signed = service({ text, manifest: { v: 1, agent: { ...releaseOf(text), sha256: sha(text) }, sig: signRelease(text, privateKey) } });
    const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
    expect(await createUpdater({ base: "https://link.test", dir, fetchImpl: signed.fetchImpl, keys: [other], prove: async () => true }).check()).toBe(null);
    expect(await createUpdater({ base: "https://link.test", dir, fetchImpl: signed.fetchImpl, keys: [pinned], prove: async () => true }).check()).toBe(NEXT);
  });
});

describe("applying", () => {
  it("waits for the link to be idle, unless the person asked", async () => {
    let idle = false;
    const applied = [];
    const updater = createUpdater({ base: "https://link.test", dir, fetchImpl: service().fetchImpl, keys: [], prove: async () => true, idle: () => idle, apply: (version) => applied.push(version) });
    expect(updater.maybeApply()).toBe(false);
    await updater.check();
    expect(updater.maybeApply()).toBe(false);
    expect(applied).toEqual([]);
    idle = true;
    expect(updater.maybeApply()).toBe(true);
    expect(applied).toEqual([NEXT]);
    const asked = createUpdater({ base: "https://link.test", dir, fetchImpl: service().fetchImpl, keys: [], prove: async () => true, idle: () => false, apply: (version) => applied.push(version) });
    expect(asked.maybeApply(true)).toBe(true);
  });

  it("the update op over the tunnel stages it and restarts the tunnel into it", async () => {
    const key = Buffer.alloc(32, 3), id = "abcdefghij";
    const posted = [];
    let served = false;
    const link = service();
    const agent = createTunnelAgent({
      base: "https://link.test", id, key: key.toString("base64url"), token: "v".repeat(43), log: () => {},
      update: { dir, fetchImpl: link.fetchImpl, keys: [], prove: async () => true, firstMs: 3_600_000 },
      fetchImpl: async (url, init = {}) => {
        if (init.method === "POST") { posted.push(...JSON.parse(init.body).frames); return Response.json({ ok: true }); }
        if (!served) { served = true; return Response.json({ frames: [sealFrame(key, id, "to-vps", { t: "ctl", r: "r".repeat(12), op: "update", data: { apply: "now" } })] }); }
        await new Promise((resolve) => init.signal?.addEventListener("abort", resolve, { once: true }));
        throw new Error("aborted");
      },
    });
    expect(await agent.run()).toBe("update");
    expect(agent.updater.status().staged).toBe(NEXT);
  });
});

describe("launching", () => {
  function stage(version, text = bumped(version)) {
    mkdirSync(join(dir, version), { recursive: true });
    writeFileSync(join(dir, version, "agent.mjs"), text);
    writeFileSync(join(dir, "ready.json"), JSON.stringify({ v: 1, version, sha256: sha(text) }));
  }

  it("the installed file runs a newer staged release, and its exit code is the release's", async () => {
    stage(NEXT);
    const release = stagedRelease({ dir });
    expect(release).toMatchObject({ version: NEXT });
    const out = [];
    expect(await launchRelease(release, { dir, argv: ["selftest"], log: (line) => out.push(line) })).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "trial.json"), "utf8"))).toMatchObject({ version: NEXT, starts: 1, good: false });
    expect(stagedRelease({ dir, current: NEXT })).toBe(null);
  }, 30_000);

  it("skips a release that changed on disk, and one that did not stay up three starts in a row", () => {
    stage(NEXT);
    writeFileSync(join(dir, NEXT, "agent.mjs"), "tampered");
    const said = [];
    expect(stagedRelease({ dir, log: (line) => said.push(line) })).toBe(null);
    expect(said[0]).toMatch(/changed on disk/);
    stage(NEXT);
    writeFileSync(join(dir, "trial.json"), JSON.stringify({ version: NEXT, starts: 3, good: false }));
    expect(stagedRelease({ dir })).toBe(null);
    writeFileSync(join(dir, "trial.json"), JSON.stringify({ version: NEXT, starts: 5, good: true }));
    expect(stagedRelease({ dir })).toMatchObject({ version: NEXT });
  });
});

describe("the link service", () => {
  it("names the agent it serves as the release, with its hash and its signature when there is one", async () => {
    const copy = join(dir, "agent.mjs");
    writeFileSync(copy, bumped("4.0.0"));
    const linkService = createLinkService({ base: "http://link.test", scriptPath: `${root}install.sh`, agentPath: copy, trustProxy: false });
    const server = createServer((req, res) => void linkService.handler(req, res));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      expect(await (await fetch(`${base}/v1/release`)).json()).toEqual({ v: 1, agent: { version: "4.0.0", protocol: LINK_PROTOCOL, sha256: sha(bumped("4.0.0")) } });
      writeFileSync(`${copy}.sig`, "c2lnbmF0dXJl\n");
      expect((await (await fetch(`${base}/v1/release`)).json()).sig).toBe("c2lnbmF0dXJl");
      expect(sha(await (await fetch(`${base}/agent.mjs`)).text())).toBe(sha(bumped("4.0.0")));
    } finally { linkService.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  });
});
