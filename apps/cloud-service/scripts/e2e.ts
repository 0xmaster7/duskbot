// One end-to-end run of a Boat-backed My Cloud: paid (fake billing), provisioned on Boat, paired, a bot made and messaged
// with a synthetic engine, a bot moved there from a local fixture with the app's own send, slept, backed up, woken, its
// machine deleted and rebuilt from the backup, then everything this run made on Boat deleted and proven gone.
//
//   node --experimental-strip-types apps/cloud-service/scripts/e2e.ts --fake                     # loopback fake Boat, no VM
//   BOAT_API_KEY=... BOAT_BASE_URL=... node --experimental-strip-types apps/cloud-service/scripts/e2e.ts --package release/home/omb-home.tgz --engine <fake-claude.mjs> --ledger <file>
//
// Real runs create at most two `small` sandboxes (the cloud, and its rebuild) under a scope label of their own, and the
// teardown deletes every sandbox with that label whatever happened. Prints timings and ids, never a key or a token.
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBilling } from "../../dashboard/server/billing/index.ts";
import { createStore } from "../../dashboard/server/store.ts";
import { startFakeBoatApi } from "../src/fake-boat-api.ts";
import { createBoatProvider } from "../src/boat.ts";
import { createCloudSend } from "../../../electron/cloud-send.mjs";
import { openOwnerSession } from "../../../electron/cloud-send-main.mjs";
import { launchVerificationServer } from "../../../scripts/control-omb.ts";

const args = process.argv.slice(2), fake = args.includes("--fake");
const option = (name: string) => { const at = args.indexOf(name); return at === -1 ? null : args[at + 1] ?? null; };
// --adopt <sandbox>: reuse a sandbox an earlier run created, wiped back to a fresh one, as this run's first sandbox, so a
// rerun stays within its sandbox budget; the run then takes that sandbox's scope
const adopt = option("--adopt");
let scope = randomBytes(8).toString("hex");
const ledger = option("--ledger");
const t0 = Date.now(), marks: Array<{ step: string; ms: number; at: string }> = [];
let last = t0;
function mark(step: string) { const now = Date.now(); marks.push({ step, ms: now - last, at: new Date(now).toISOString() }); console.log(`[${((now - t0) / 1000).toFixed(1)}s] ${step} (+${((now - last) / 1000).toFixed(1)}s)`); last = now; }
function note(line: string) { console.log(`  ${line}`); if (ledger) appendFileSync(ledger, `${new Date().toISOString()} ${line}\n`); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const dataDir = mkdtempSync(join(tmpdir(), "omb-boat-e2e-"));
const api = fake ? await startFakeBoatApi() : null;
if (api) api.onCommand(({ sandbox, command }) => {
  if (command.includes("omb-home start") && !sandbox.volume.size) {
    sandbox.volume.set("__system__/data/.omb-cloud-home.json", Buffer.from(JSON.stringify({ version: 1, machine: sandbox.labels["omb.cloud"] })));
    sandbox.volume.set("__system__/data/.openmausbot/config.json", Buffer.from("{}"));
  }
  return { exitCode: 0, stdout: command.includes("omb-home install") ? "installed\n" : command.includes("omb-home start") ? "started\n" : command.includes("restore") ? "restored\n" : "" };
});
const key = api?.key ?? process.env.BOAT_API_KEY, baseUrl = api?.baseUrl ?? process.env.BOAT_BASE_URL;
if (!key || !baseUrl) { console.error("BOAT_API_KEY and BOAT_BASE_URL are required (or --fake)."); process.exit(2); }
const packageFile = fake ? join(dataDir, "pkg.tgz") : resolve(option("--package") ?? "release/home/omb-home.tgz");
if (fake) (await import("node:fs")).writeFileSync(packageFile, "fake package");
const sha256 = createHash("sha256").update(readFileSync(packageFile)).digest("hex");
const apiBase = `${baseUrl.replace(/\/$/, "")}${baseUrl.includes("/api/v1") ? "" : "/api/v1"}`;
const rawSandbox = async (id: string) => (await (await fetch(`${apiBase}/sandboxes/${id}`, { headers: { authorization: `Bearer ${key}` } })).json() as { sandbox?: { labels?: Record<string, string> } }).sandbox;
if (adopt) scope = (await rawSandbox(adopt))?.labels?.["omb.scope"] ?? scope;
const ops = createBoatProvider({ apiKey: key, baseUrl, scope });
let adopted = false;
const WIPE = ["/data", "/etc/openmausbot", "/usr/lib/openmausbot", "/opt/openmausbot", "/usr/local/sbin/omb-home", "/usr/local/bin/node", "/usr/local/bin/caddy",
  "/etc/systemd/system/omb-home.service", "/etc/systemd/system/omb-docker-gate.service", "/home/user/.boat", "/home/user/.boatignore", "/home/user/omb-home.tgz"];

// the homes' signed reads go to the real origins; in --fake mode the "homes" answer from here
const homeFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (adopt && !adopted && init?.method === "POST" && url.pathname.endsWith("/api/v1/sandboxes")) {
    adopted = true;
    const body = JSON.parse(String(init.body)) as { setupScript: string; files: Array<{ path: string; content: string }> };
    if ((await ops.sandbox(adopt))?.state === "archived") await ops.power(adopt, "on");
    for (let n = 0; n < 60 && !["ready", "idle", "running"].includes((await ops.sandbox(adopt))?.state ?? ""); n++) await sleep(3000);
    const wipe = await ops.run(adopt, `sudo systemctl stop omb-home omb-docker-gate >/dev/null 2>&1; sudo rm -r -f ${WIPE.join(" ")}; sudo systemctl daemon-reload; echo wiped`, 120);
    note(`adopted ${adopt}: wiped ${wipe.ok}`);
    await ops.upload(adopt, body.files[0]!.path, Buffer.from(body.files[0]!.content));
    await ops.upload(adopt, "/home/user/omb-setup.sh", Buffer.from(body.setupScript));
    const setup = await ops.run(adopt, "bash /home/user/omb-setup.sh > /home/user/omb-setup.log 2>&1; code=$?; rm -f /home/user/omb-setup.sh; echo setup-exit-$code", 600);
    note(`adopted setup: ${setup.stdout.trim()}`);
    const hosted = await ops.origin(adopt);
    return new Response(JSON.stringify({ ok: true, type: "sandbox.created", status: "ready", sandbox: await rawSandbox(adopt), hostedPorts: [{ port: 8080, url: hosted }] }),
      { status: 202, headers: { "content-type": "application/json" } });
  }
  if (fake && url.hostname.endsWith(".on.boat.dev")) {
    const body = url.pathname === "/api/cloud/health" ? { v: 1 } : url.pathname === "/api/cloud/power" ? { v: 1, idle: false, busy: ["turn"], nextDueAt: null }
      : url.pathname === "/api/cloud/pairing" ? { code: "ABCD-EFGH-JKLM", expiresAt: Date.now() + 300_000 } : { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }
  return fetch(input, init);
};

const store = createStore(dataDir);
const account = { id: "acct_e2e", email: "e2e@example.test" };
const billing = createBilling({ dataDir, publicUrl: "https://dashboard.e2e.invalid", dashboard: { state: store.state, changed: () => store.changed() }, fetch: homeFetch,
  accounts: { fromCookie: () => account, fromBearer: () => account },
  mail: (cloud, letter) => note(`notice to owner: ${letter.subject} for ${cloud.id}`),
  alert: entry => note(`ALERT ${entry.action} ${entry.cloudId} (${entry.reason})`),
  env: { OMB_BILLING_PROVIDER: "fake", OMB_CLOUD_SEAL_KEY: randomBytes(32).toString("base64url"), OMB_MANAGED: "1", BOAT_API_KEY: key, BOAT_BASE_URL: baseUrl, OMB_MANAGED_SCOPE: scope,
    OMB_MANAGED_KINDS: "shared_s", OMB_MANAGED_HOME_PACKAGE_FILE: packageFile, OMB_MANAGED_HOME_PACKAGE_SHA256: sha256, OMB_MANAGED_LEASE_HOURS: "1", OMB_MANAGED_IDLE_MINUTES: "5", OMB_MANAGED_LOST_AFTER_MINUTES: "2", OMB_POOL_DRIVER: "fake" } });
const webhooks = createServer((req, res) => void billing.handle(req, res, new URL(req.url ?? "/", "http://127.0.0.1")).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }));
await new Promise<void>(r => webhooks.listen(0, "127.0.0.1", r));
const hookBase = `http://127.0.0.1:${(webhooks.address() as { port: number }).port}`;

const created = new Set<string>();
async function track() { for (const s of await ops.inventory()) if (!created.has(s.id)) { created.add(s.id); note(`created sandbox ${s.id} (${s.type}) for ${s.cloudId}`); } }
let local: Awaited<ReturnType<typeof launchVerificationServer>> | null = null;
const results: Record<string, unknown> = { scope };

async function reconcileUntil(cloudId: string, done: () => boolean, limitMs: number, label: string) {
  const deadline = Date.now() + limitMs;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`${label}: timed out (status ${billing.clouds.get(cloudId)?.status}, step ${billing.clouds.get(cloudId)?.setupStep}, error ${billing.clouds.get(cloudId)?.error})`);
    const c = billing.clouds.get(cloudId)!; c.nextAttemptAt = 0;
    await billing.clouds.reconcile(); await track();
    if (!done()) await sleep(fake ? 200 : 3000);
  }
}
async function json(response: Response) { const text = await response.text(); try { return JSON.parse(text); } catch { return { raw: text.slice(0, 200) }; } }

try {
  mark("start");
  // 1. paid: a fake checkout completes and its signed webhooks activate the cloud
  const answer = await billing.service.checkout(account, { kind: "cart", cart: { interval: "month", license: { kind: "none" }, desktop: { kind: "shared_s", region: "fsn1" } } } as never, { source: "e2e" } as never) as { cloudId: string };
  const checkout = (JSON.parse(readFileSync(join(dataDir, "billing.json"), "utf8")) as { checkouts: Array<{ providerSessionId: string | null; cloudId: string | null }> }).checkouts.at(-1)!;
  for (const delivery of billing.fake!.complete(checkout.providerSessionId!)) {
    const res = await fetch(`${hookBase}/v1/billing/webhooks/dodo`, { method: "POST", headers: { "content-type": "application/json", ...delivery.headers }, body: new Uint8Array(delivery.body) });
    if (!res.ok) throw new Error(`webhook refused: ${res.status}`);
  }
  const cloudId = answer.cloudId ?? checkout.cloudId!;
  const cloud = () => billing.clouds.get(cloudId)!;
  note(`cloud ${cloudId} backend=${cloud().backend} status=${cloud().status}`);
  mark("paid and activated");

  // 2. provisioned on Boat
  await reconcileUntil(cloudId, () => cloud().status === "running", 25 * 60_000, "provision");
  note(`origin ${cloud().origin} sandbox ${cloud().serverId}`);
  results.provisionMs = Date.now() - last; mark("provisioned and healthy");

  // a synthetic engine on the home, so a bot can answer (test tooling only, never part of the product install)
  if (!fake) {
    const engine = readFileSync(resolve(option("--engine")!));
    const wrapper = `#!/bin/sh\nif [ "$1" = auth ]; then echo '{"loggedIn":true,"email":"person@example.test"}'; exit 0; fi\nexport FAKE_CLAUDE_VERSION=2.1.284\nexec /usr/lib/openmausbot/node/bin/node /opt/omb-test/fake-claude.mjs "$@"\n`;
    await ops.upload(cloud().serverId!, "/home/user/fake-claude.mjs", engine);
    await ops.upload(cloud().serverId!, "/home/user/claude-wrapper.sh", Buffer.from(wrapper));
    const done = await ops.run(cloud().serverId!, "sudo install -d -m 0755 /opt/omb-test && sudo install -m 0755 /home/user/fake-claude.mjs /opt/omb-test/fake-claude.mjs && sudo install -m 0755 /home/user/claude-wrapper.sh /usr/local/bin/claude && sudo systemctl restart omb-home && sleep 10 && echo ok", 120);
    note(`synthetic engine installed: ${done.ok}`);
  }

  // 3. linked: the account's pairing, redeemed at the home as the app redeems it
  const target = { origin: cloud().origin!, grant: () => billing.clouds.pair(account.id, cloudId) };
  let session: Awaited<ReturnType<typeof openOwnerSession>> | null = null;
  if (!fake) {
    session = await openOwnerSession(target, fetch, { label: "Boat e2e", background: false });
    const health = await session.call("GET", "/api/health");
    note(`paired; /api/health ${health.status}`);
    mark("paired");
    // 4. a bot made there, and messaged
    const made = await session.call("POST", "/api/bots", { name: "Boat e2e bot" });
    const botId = made.body?.bot?.id as string, threadId = made.body?.bot?.threadId as string;
    note(`bot on the cloud: ${made.status} ${botId}`);
    const sent = await session.call("POST", `/api/bots/${botId}/messages`, { text: "hello from the Boat e2e run", threadId });
    let reply: string | null = null;
    for (let n = 0; n < 60 && !reply; n++) {
      await sleep(2000);
      const rows = await session.call("GET", `/api/threads/${threadId}/messages?limit=20`);
      const messages = (rows.body?.messages ?? []) as Array<{ role?: string; kind?: string; text?: string }>;
      reply = messages.find(m => m.role === "bot" && m.kind === "text" && m.text?.trim())?.text ?? null;
    }
    note(`message sent ${sent.status}; reply: ${reply ? JSON.stringify(reply.slice(0, 80)) : "none"}`);
    results.botId = botId; results.reply = reply !== null;
    mark("bot made and answered");

    // 5. a bot moved there from this computer, with the app's own send (cloud-send.mjs)
    local = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_VERSION: "2.1.284" });
    const localApi = (route: string, init?: RequestInit) => fetch(`${local!.info.url}${route}`, init);
    const mine = await json(await localApi("/api/bots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Moved to Boat" }) }));
    const movedId = mine.bot.id as string;
    const localSent = await localApi(`/api/bots/${movedId}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "a chat that should move with me", threadId: mine.bot.threadId }) });
    await sleep(8000);
    note(`local bot ${movedId}: message ${localSent.status}`);
    const reader = await openOwnerSession(target, fetch, { label: "Boat e2e read", background: true });
    let kept: unknown = null;
    const send = createCloudSend({
      local: (route: string, init?: RequestInit) => localApi(route, init),
      cloud: { origin: () => target.origin, asleep: () => false, read: (route: string) => reader.fetch!(route),
        open: () => openOwnerSession(target, fetch, { label: "Boat e2e move", background: false }) },
      handoff: async () => { throw new Error("no sign-ins in this run"); },
      store: { read: () => kept, write: (value: unknown) => { kept = value; } },
    });
    let outcome: unknown;
    try { outcome = await send.send({ reason: "button" }); } catch (error) { note(`send failed: ${error instanceof Error ? error.message : String(error)}`); }
    const there = await session.call("GET", "/api/bots?messages=0");
    const movedThere = (there.body?.bots ?? []).find((b: { name?: string }) => b.name === "Moved to Boat");
    const arrived = Boolean(movedThere);
    if (movedThere?.threadId) { const rows = await session.call("GET", `/api/threads/${movedThere.threadId}/messages?limit=20`); note(`moved chat rows on the cloud: ${(rows.body?.messages ?? []).length}`); results.movedRows = (rows.body?.messages ?? []).length; }
    note(`moved bot arrived on the cloud: ${arrived}; sent ${JSON.stringify((outcome as { result?: { bots?: unknown[] } } | undefined)?.result?.bots?.length ?? null)} bots`);
    results.moved = arrived;
    mark("bot moved there");
  }

  // 6. paused: the owner sleeps it (the idle handshake is the same stop), and its volume is backed up off Boat
  await billing.clouds.power(account.id, cloudId, "off");
  await reconcileUntil(cloudId, () => cloud().status === "sleeping", 10 * 60_000, "sleep");
  mark("asleep (Boat stopped)");
  await reconcileUntil(cloudId, () => (cloud().managed?.backups.at(-1)?.verifiedAt ?? null) !== null, 15 * 60_000, "backup");
  const backup = cloud().managed!.backups.at(-1)!;
  note(`backup ${backup.file}: ${backup.bytes} bytes, verified`);
  results.backupBytes = backup.bytes;
  mark("backed up and verified");

  // 7. resumed for its owner
  await billing.clouds.power(account.id, cloudId, "on");
  await reconcileUntil(cloudId, () => cloud().status === "running", 10 * 60_000, "wake");
  results.wakeMs = Date.now() - last; mark("woken and healthy");
  if (session) {
    const bots = await session.call("GET", "/api/bots?messages=0");
    note(`after wake the session still works: ${bots.status}, bots ${JSON.stringify((bots.body?.bots ?? bots.body ?? []).map((b: { name?: string }) => b.name))}`);
  }

  // 8. the machine is deleted out from under it: rebuilt from the backup into a fresh sandbox
  const lost = cloud().serverId!;
  if (api) api.lose(lost); else await ops.requestDelete(lost);
  note(`deleted sandbox ${lost} (as if the machine were lost)`);
  for (let n = 0; n < 40 && (await ops.sandbox(lost)) !== null; n++) await sleep(fake ? 0 : 3000);
  await reconcileUntil(cloudId, () => cloud().status === "running" && cloud().serverId !== lost, 30 * 60_000, "recovery");
  note(`recovered into ${cloud().serverId} at ${cloud().origin}`);
  results.recoveryMs = Date.now() - last; mark("recovered from backup");
  if (!fake) {
    const again = await openOwnerSession({ origin: cloud().origin!, grant: () => billing.clouds.pair(account.id, cloudId) }, fetch, { label: "Boat e2e after recovery", background: true });
    const bots = await again.call("GET", "/api/bots?messages=0");
    const names = (bots.body?.bots ?? bots.body ?? []).map((b: { name?: string }) => b.name);
    note(`after recovery: bots ${JSON.stringify(names)}`);
    results.recoveredBots = names;
  }
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  results.failed = error instanceof Error ? error.message : String(error);
} finally {
  // teardown: every sandbox under this run's scope, deleted and proven gone with a direct read
  await track().catch(() => {});
  for (const id of created) {
    const answer = await ops.requestDelete(id).catch(error => ({ error: String(error) }));
    note(`teardown delete ${id}: ${JSON.stringify(answer)}`);
  }
  for (let n = 0; n < 40; n++) {
    const left = (await Promise.all([...created].map(async id => (await ops.sandbox(id).catch(() => ({ id }))) ? id : null))).filter(Boolean);
    if (!left.length) break;
    await sleep(fake ? 0 : 3000);
  }
  const remaining = (await Promise.all([...created].map(async id => (await ops.sandbox(id).catch(() => ({ id }))) ? id : null))).filter(Boolean);
  const listed = await ops.inventory().catch(() => [{ id: "unknown" }]);
  note(`after teardown: direct reads find ${remaining.length}, scope list finds ${listed.length}`);
  results.leftOnBoat = remaining.length + listed.length;
  results.sandboxes = [...created];
  results.marks = marks;
  billing.close(); store.close?.(); webhooks.close(); await api?.close(); await local?.close().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
  console.log(JSON.stringify(results, null, 2));
  process.exit(results.failed ? 1 : 0);
}
