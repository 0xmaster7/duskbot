import { createHash, createPrivateKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SIGNATURE_HEADERS, signedPayload } from "../shared/dashboard-protocol.ts";
import type { CommandResult, DashboardCommand, EnrollAnswer, EnrollRequest, ReportAnswer, WorkspaceReport } from "../shared/dashboard-protocol.ts";
import type { createDashboardCollector } from "./dashboard-report.ts";

interface LinkState {
  v: 1;
  url: string;
  workspaceId: string;
  publicKey: string;
  privateKey: string;
  enrolledAt: number;
  claimed?: boolean;
}
export interface DashboardReporterDeps {
  dataDir: string;
  collect: ReturnType<typeof createDashboardCollector>;
  execute(command: DashboardCommand): Promise<CommandResult>;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}
let sequence = Date.now();
const REMOVED = "This workspace was removed from the dashboard. Connect it again from the app.";

export function createDashboardReporter(deps: DashboardReporterDeps) {
  const file = join(deps.dataDir, "dashboard-link.json"), fetcher = deps.fetch ?? fetch, now = deps.now ?? Date.now;
  let state: LinkState | null = null;
  let lastReportAt: number | null = null, lastError: string | null = null, watching = false;
  let running = false, generation = 0, removed = false;
  let wakeReport: (() => void) | undefined, urgent = false;
  // a command changes devices or routines: the next report carries them at once
  let changed = false;
  const requests = new Set<AbortController>(), sleepers = new Set<() => void>();
  const results = new Map<string, CommandResult>(), executed = new Set<string>();
  let commands = Promise.resolve();
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as LinkState;
    if (saved.v === 1 && saved.url && saved.workspaceId && saved.publicKey && saved.privateKey) {
      createPrivateKey({ key: Buffer.from(saved.privateKey, "base64"), format: "der", type: "pkcs8" });
      state = saved;
      chmodSync(file, 0o600);
    }
  } catch {}

  function save(value: LinkState) {
    mkdirSync(deps.dataDir, { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      renameSync(temporary, file);
    } finally { try { unlinkSync(temporary); } catch {} }
  }
  function stop() {
    running = false;
    generation++;
    for (const request of requests) request.abort();
    for (const finish of Array.from(sleepers)) finish();
    wakeReport = undefined;
  }
  function requestReport() { urgent = true; wakeReport?.(); }
  function pause(ms: number, report = false): Promise<void> {
    if (report && urgent) { urgent = false; return Promise.resolve(); }
    return new Promise((resolve) => {
      const finish = () => { clearTimeout(timer); sleepers.delete(finish); if (wakeReport === finish) wakeReport = undefined; if (report) urgent = false; resolve(); };
      const timer = setTimeout(finish, ms);
      sleepers.add(finish);
      if (report) wakeReport = finish;
    });
  }
  async function request(method: string, path: string, body?: WorkspaceReport): Promise<ReportAnswer> {
    const linked = state!;
    const bytes = body ? JSON.stringify(body) : "", time = now();
    const target = new URL(`${linked.url}${path}`);
    const signature = sign(null, Buffer.from(signedPayload(method, `${target.pathname}${target.search}`, time, createHash("sha256").update(bytes).digest("hex"))),
      createPrivateKey({ key: Buffer.from(linked.privateKey, "base64"), type: "pkcs8", format: "der" })).toString("base64");
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 35_000);
    requests.add(controller);
    try {
      const response = await fetcher(target.toString(), { method, redirect: "error", signal: controller.signal,
        headers: { "content-type": "application/json", [SIGNATURE_HEADERS.workspace]: linked.workspaceId, [SIGNATURE_HEADERS.time]: String(time), [SIGNATURE_HEADERS.signature]: signature },
        ...(method === "GET" ? {} : { body: bytes }) });
      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { code?: string };
        if (response.status === 401 && /(?:workspace.*(?:unknown|removed|not_found|deleted)|(?:unknown|removed|deleted).*workspace)/i.test(error.code ?? "")) {
          removed = true; watching = false; lastError = REMOVED; stop();
        }
        throw new Error(`Dashboard request failed (${response.status}).`);
      }
      return await response.json() as ReportAnswer;
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }
  function accept(answer: ReportAnswer, run: number) {
    const beganWatching = !watching && answer.watching;
    watching = answer.watching;
    if (beganWatching) requestReport();
    for (const command of answer.commands ?? []) {
      if (executed.has(command.id)) continue;
      executed.add(command.id);
      commands = commands.then(async () => {
        if (!running || generation !== run) return;
        let result: CommandResult;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          if (command.expiresAt <= now()) throw new Error("This command expired before it could run.");
          result = await Promise.race([deps.execute(command), new Promise<CommandResult>((_, reject) => {
            timer = setTimeout(() => reject(new Error("This command took too long to finish.")), 60_000);
          })]);
        } catch {
          result = { id: command.id, ok: false, message: command.expiresAt <= now() ? "This command expired before it could run." : "This command could not finish in time.", at: now() };
        } finally { clearTimeout(timer); }
        if (!running || generation !== run) return;
        results.set(command.id, { ...result, id: command.id });
        changed = true;
        requestReport();
      });
    }
  }
  function failure(loop: string) {
    if (!removed) lastError = "Could not reach the dashboard. Retrying shortly.";
    deps.log?.(`Dashboard ${loop} failed; retrying.`);
  }
  async function reports(run: number) {
    let backoff = 5000;
    let devicesAt: number | null = null, activityAt: number | null = null, plansAt: number | null = null;
    let lastPlans: WorkspaceReport["plans"] | null;
    while (running && generation === run) {
      try {
        const at = now(), pending = [...results.values()].slice(0, 50);
        const [machine, computers] = await Promise.all([deps.collect.machine(), deps.collect.computers()]);
        const report: WorkspaceReport = { v: 1, seq: ++sequence, at, workspace: deps.collect.workspace(), machine, computers, bots: deps.collect.bots(), results: pending };
        const fresh = changed; changed = false;
        if (fresh || devicesAt === null || at - devicesAt >= 30_000) report.devices = await deps.collect.devices();
        if (activityAt === null || at - activityAt >= 60_000) report.activity = await deps.collect.activity();
        const plans = await deps.collect.plans();
        const plansDue = plansAt === null || at - plansAt >= 300_000 || plans !== lastPlans;
        if (plansDue && plans) report.plans = plans;
        if (!running || generation !== run) return;
        const answer = await request("POST", "/v1/report", report);
        if (!running || generation !== run) return;
        for (const result of pending) results.delete(result.id);
        if (report.devices) devicesAt = at;
        if (report.activity) activityAt = at;
        if (plansDue) { plansAt = at; lastPlans = plans; }
        lastReportAt = now(); lastError = null; backoff = 5000;
        accept(answer, run);
        await pause(Math.max(2000, Math.min(600_000, Number(answer.nextReportMs) || 180_000)), true);
      } catch {
        if (!running || generation !== run) return;
        failure("report"); await pause(backoff); backoff = Math.min(60_000, backoff * 2);
      }
    }
  }
  async function wait(run: number) {
    let backoff = 5000;
    while (running && generation === run) {
      try {
        const answer = await request("GET", "/v1/wait?wait=25");
        if (!running || generation !== run) return;
        accept(answer, run); backoff = 5000;
        await pause(100);
      } catch {
        if (!running || generation !== run) return;
        failure("wait"); await pause(backoff); backoff = Math.min(60_000, backoff * 2);
      }
    }
  }
  function start() {
    if (running || !state || removed) return;
    running = true;
    const run = ++generation;
    void reports(run); void wait(run);
  }
  async function link(url: string, { enrollToken }: { enrollToken?: string } = {}): Promise<EnrollAnswer> {
    const normalized = url.replace(/\/+$/, "");
    const keys = state?.url === normalized ? state : (() => {
      const pair = generateKeyPairSync("ed25519");
      return { publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64"), privateKey: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64") };
    })();
    const workspace = deps.collect.workspace();
    const body: EnrollRequest = { v: 1, publicKey: keys.publicKey, name: workspace.name, kind: workspace.kind, version: workspace.version, ...(enrollToken === undefined ? {} : { enrollToken }) };
    const bytes = JSON.stringify(body), headers: Record<string, string> = { "content-type": "application/json" };
    if (enrollToken !== undefined) {
      const time = now();
      headers[SIGNATURE_HEADERS.time] = String(time);
      headers[SIGNATURE_HEADERS.signature] = sign(null, Buffer.from(signedPayload("POST", new URL(`${normalized}/v1/enroll`).pathname, time, createHash("sha256").update(bytes).digest("hex"))),
        createPrivateKey({ key: Buffer.from(keys.privateKey, "base64"), type: "pkcs8", format: "der" })).toString("base64");
    }
    const response = await fetcher(`${normalized}/v1/enroll`, { method: "POST", redirect: "error", headers, body: bytes, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Dashboard enrollment failed (${response.status}).`);
    const answer = await response.json() as EnrollAnswer;
    if (answer.v !== 1 || !answer.workspaceId || !answer.claimUrl || typeof answer.claimExpiresAt !== "number") throw new Error("The dashboard returned an invalid enrollment.");
    const next: LinkState = { v: 1, url: normalized, workspaceId: answer.workspaceId, publicKey: keys.publicKey, privateKey: keys.privateKey, enrolledAt: now(), claimed: answer.claimExpiresAt === 0 };
    save(next); stop(); state = next; removed = false; lastError = null; watching = false;
    results.clear(); executed.clear(); commands = Promise.resolve(); start();
    return answer;
  }
  async function forget() {
    stop(); state = null; removed = false; watching = false; lastError = null; lastReportAt = null;
    results.clear(); executed.clear();
    try { unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return {
    status: () => ({ connected: state !== null && !removed, url: state?.url ?? null, workspaceId: state?.workspaceId ?? null, lastReportAt, lastError, watching }),
    link, forget, start, stop,
  };
}
