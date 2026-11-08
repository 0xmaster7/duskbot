import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SIGNATURE_HEADERS, signedPayload } from "../shared/dashboard-protocol.ts";
import type { DashboardCommand, WorkspaceReport } from "../shared/dashboard-protocol.ts";
import type { createDashboardCollector } from "./dashboard-report.ts";
import { createDashboardReporter } from "./dashboard-reporter.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const servers: Server[] = [], dirs: string[] = [], reporters: ReturnType<typeof createDashboardReporter>[] = [];
afterEach(async () => {
  reporters.splice(0).forEach((reporter) => reporter.stop());
  await Promise.all(servers.splice(0).map((server) => { server.closeAllConnections(); return new Promise((done) => server.close(done)); }));
  await Promise.all(dirs.splice(0).map(removeTempDir));
});
function collector(): ReturnType<typeof createDashboardCollector> {
  const plans = { providers: [] };
  return {
    workspace: () => ({ name: "Fixture", kind: "linux", version: "1", platform: "linux" }),
    machine: async () => ({ host: { hostname: "fixture", platform: "linux", arch: "x64", cpus: 1, cpuModel: null }, cpu: { percent: 0, load: [0, 0, 0] }, memory: { usedBytes: 1, totalBytes: 2 }, disk: null, network: null, uptimeSec: 1, processUptimeSec: 1, app: { version: "1", node: "22" }, update: null, services: [] }),
    computers: async () => ({ provider: "none", computers: [] }), bots: () => [], devices: async () => ({ thisDevice: { label: "Fixture", kind: "linux" }, link: null, phones: [], sessions: [] }),
    activity: async () => ({ from: "2026-01-01", to: "2026-11-08", timeZone: "UTC", days: [], byBot: [], byModel: [], totals: { turns: 0, tokens: 0, costUsd: null } }), plans: async () => plans,
  };
}
async function fixture(prefix = "") {
  const dir = mkdtempSync(join(tmpdir(), "dashboard-reporter-")); dirs.push(dir);
  const reports: WorkspaceReport[] = [], signatures: boolean[] = [], enrollKeys: string[] = [], enrollTokens: unknown[] = [], enrollSignatures: (boolean | null)[] = [];
  let publicKey = "", nextCommand: DashboardCommand | null = null, removed = false, watching = false, waits = 0;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    const reply = (status: number, body: object) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.url === `${prefix}/v1/enroll`) {
      const body = JSON.parse(bytes.toString()); publicKey = body.publicKey; enrollKeys.push(publicKey); enrollTokens.push(body.enrollToken);
      const signature = req.headers[SIGNATURE_HEADERS.signature], time = req.headers[SIGNATURE_HEADERS.time];
      enrollSignatures.push(signature === undefined && time === undefined ? null : typeof time === "string" && Number.isSafeInteger(Number(time)) && verify(null,
        Buffer.from(signedPayload("POST", req.url!, Number(time), createHash("sha256").update(bytes).digest("hex"))),
        createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(String(signature), "base64")));
      expect(body).toMatchObject({ v: 1, name: "Fixture", kind: "linux", version: "1" });
      reply(200, { v: 1, workspaceId: "workspace", claimUrl: `${base}/claim`, dashboardUrl: base, claimExpiresAt: 0 }); return;
    }
    const time = Number(req.headers[SIGNATURE_HEADERS.time]);
    signatures.push(req.headers[SIGNATURE_HEADERS.workspace] === "workspace" && verify(null,
      Buffer.from(signedPayload(req.method!, req.url!, time, createHash("sha256").update(bytes).digest("hex"))),
      createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(String(req.headers[SIGNATURE_HEADERS.signature]), "base64")));
    if (removed) return reply(401, { code: "workspace_removed" });
    let commands: DashboardCommand[] = [];
    if (req.url === `${prefix}/v1/report`) reports.push(JSON.parse(bytes.toString()));
    if (req.url === `${prefix}/v1/wait?wait=25`) { waits++; if (nextCommand) { commands = [nextCommand]; nextCommand = null; } }
    reply(200, { v: 1, watching, nextReportMs: 600_000, commands });
  });
  servers.push(server); await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${prefix}`;
  const execute = vi.fn(async (command: DashboardCommand) => ({ id: command.id, ok: true, message: "Paused Morning brief.", at: Date.now() }));
  const make = (collect = collector()) => { const reporter = createDashboardReporter({ dataDir: dir, collect, execute }); reporters.push(reporter); return reporter; };
  return { dir, base, reports, signatures, enrollKeys, enrollTokens, enrollSignatures, execute, make, queue: (command: DashboardCommand) => { nextCommand = command; }, remove: () => { removed = true; }, watch: () => { watching = true; }, waits: () => waits };
}
const command: DashboardCommand = { id: "command", kind: "routine.pause", target: "routine", issuedAt: Date.now(), expiresAt: Date.now() + 60_000 };

describe("dashboard reporter", () => {
  it("signs the exact token enrollment body and prefixed path with the chosen workspace key, while legacy enrollment stays unsigned", async () => {
    const f = await fixture("/accounts"), reporter = f.make(), enrollToken = "e".repeat(43);
    await reporter.link(`${f.base}/`, { enrollToken });
    expect(f.enrollTokens).toEqual([enrollToken]); expect(f.enrollSignatures).toEqual([true]);
    const saved = readFileSync(join(f.dir, "dashboard-link.json"), "utf8"); expect(saved).not.toContain(enrollToken);
    await reporter.link(f.base, { enrollToken }); expect(f.enrollSignatures).toEqual([true, true]); expect(f.enrollKeys[1]).toBe(f.enrollKeys[0]);
    await reporter.link(f.base); expect(f.enrollSignatures).toEqual([true, true, null]); expect(f.enrollTokens[2]).toBeUndefined();
  });
  it("enrolls, signs exact requests, executes a waited command and immediately delivers its result", async () => {
    const f = await fixture(), collect = collector(), activity = vi.spyOn(collect, "activity"), devices = vi.spyOn(collect, "devices"), plans = vi.spyOn(collect, "plans");
    const reporter = f.make(collect);
    expect(reporter.status().connected).toBe(false); reporter.start(); expect(f.reports).toHaveLength(0);
    await reporter.link(f.base);
    await vi.waitFor(() => expect(f.reports.length).toBeGreaterThan(0));
    f.queue(command);
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledWith(command));
    await vi.waitFor(() => expect(f.reports.some((report) => report.results?.some((result) => result.id === command.id && result.ok))).toBe(true));
    expect(f.signatures.every(Boolean)).toBe(true);
    expect(f.reports[0]).toMatchObject({ v: 1, workspace: collect.workspace(), machine: expect.any(Object), computers: expect.any(Object), devices: expect.any(Object), activity: expect.any(Object), plans: expect.any(Object) });
    // the report carrying a command's result resends devices at once, so a revoke shows without waiting
    const carrying = f.reports.find((report) => report.results?.some((result) => result.id === command.id))!;
    expect(carrying.devices).toEqual(expect.any(Object)); expect(activity).toHaveBeenCalledOnce(); expect(devices).toHaveBeenCalledTimes(2); expect(plans).toHaveBeenCalledTimes(2); expect(f.reports[1].plans).toBeUndefined();
    expect(reporter.status()).toMatchObject({ connected: true, url: f.base, workspaceId: "workspace", lastReportAt: expect.any(Number), lastError: null });
    const file = join(f.dir, "dashboard-link.json"); expect(statSync(file).mode & 0o777).toBe(0o600);
    const saved = JSON.parse(readFileSync(file, "utf8")); expect(saved).toMatchObject({ v: 1, url: f.base, workspaceId: "workspace", claimed: true });
    expect(createPublicKey({ key: Buffer.from(saved.publicKey, "base64"), format: "der", type: "spki" }).asymmetricKeyType).toBe("ed25519");
    await reporter.link(f.base); expect(f.enrollKeys[1]).toBe(f.enrollKeys[0]);
    await reporter.forget(); expect(existsSync(file)).toBe(false); expect(reporter.status().connected).toBe(false);
  });
  it("pushes immediately when watching starts and keeps seq increasing across recreated reporters", async () => {
    const f = await fixture(), first = f.make(); await first.link(f.base);
    await vi.waitFor(() => expect(f.reports).toHaveLength(1));
    f.watch(); await vi.waitFor(() => expect(f.reports.length).toBeGreaterThan(1));
    expect(first.status().watching).toBe(true); first.stop();
    const seq = f.reports.at(-1)!.seq, second = f.make(); second.start();
    await vi.waitFor(() => expect(f.reports.at(-1)!.seq).toBeGreaterThan(seq));
    expect(second.status().connected).toBe(true);
  });
  it("stops both loops on a removed workspace while keeping the link and human error", async () => {
    const f = await fixture(), reporter = f.make(); await reporter.link(f.base);
    await vi.waitFor(() => expect(f.reports).toHaveLength(1)); f.remove();
    await vi.waitFor(() => expect(reporter.status().lastError).toBe("This workspace was removed from the dashboard. Connect it again from the app."));
    const count = f.signatures.length; await new Promise((resolve) => setTimeout(resolve, 250));
    expect(f.signatures).toHaveLength(count); expect(reporter.status().connected).toBe(false);
    reporter.start(); expect(f.signatures).toHaveLength(count); expect(existsSync(join(f.dir, "dashboard-link.json"))).toBe(true);
  });
});
