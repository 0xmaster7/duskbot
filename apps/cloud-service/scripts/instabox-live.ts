// One real run of a managed home on InstaBox, as a person uses it: paid (fake billing), provisioned through the real
// lifecycle and signed home package, paired, three bots made and messaged (a synthetic engine), their computers woken on
// the same machine, the desktop stream opened, a bot's browser sent to everyday websites, files and a browser profile
// checked, paused and resumed with memory, a routine run across a pause, crashes recovered from, a bot moved there
// from a local fixture with the app's own send, then the home moved to Boat and rolled back on purpose. Everything this
// run made on either provider is deleted at the end and proven gone. Prints timings and ids, never a key or a token.
//
//   INSTABOX_API_KEY=... BOAT_API_KEY=... BOAT_BASE_URL=... node --experimental-strip-types apps/cloud-service/scripts/instabox-live.ts \
//     --package release/home/omb-home.tgz --out <results.json> [--skip-boat] [--skip-move]
//
// Test-only deviations from production, each because this run has no production entitlement key: the machine's boot
// env drops DUSK_CLOUD_ENTITLEMENT=required before the home first starts, and the account service's entitlement push is
// answered by this script. Nothing else differs.
import { CLOUD_HOME } from "../../../electron/legacy-names.mjs";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBilling } from "../../dashboard/server/billing/index.ts";
import { createStore } from "../../dashboard/server/store.ts";
import { createCloudSend } from "../../../electron/cloud-send.mjs";
import { openOwnerSession } from "../../../electron/cloud-send-main.mjs";
import { launchVerificationServer } from "../../../scripts/control-omb.ts";
import { createBoatProvider } from "../src/boat.ts";
import { createInstaboxProvider, instaboxUsageCents } from "../src/instabox.ts";
import { generateEntitlementSigner } from "../../../shared/entitlement.ts";

const args = process.argv.slice(2);
const option = (name: string) => { const at = args.indexOf(name); return at === -1 ? null : args[at + 1] ?? null; };
const ibxKey = process.env.INSTABOX_API_KEY, boatKey = process.env.BOAT_API_KEY, boatBase = process.env.BOAT_BASE_URL;
if (!ibxKey) { console.error("INSTABOX_API_KEY is required."); process.exit(2); }
const withBoat = !args.includes("--skip-boat") && !!boatKey && !!boatBase;
const out = resolve(option("--out") ?? "instabox-live.json");
const scope = randomBytes(8).toString("hex");
const t0 = Date.now(), marks: Array<{ step: string; ms: number; at: string }> = [];
let last = t0;
const results: Record<string, unknown> = { scope, startedAt: new Date(t0).toISOString(), steps: [] as unknown[] };
function mark(step: string) { const now = Date.now(); marks.push({ step, ms: now - last, at: new Date(now).toISOString() }); console.log(`[${((now - t0) / 1000).toFixed(1)}s] ${step} (+${((now - last) / 1000).toFixed(1)}s)`); last = now; }
const note = (line: string) => console.log(`  ${line}`);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function step<T>(name: string, fn: () => Promise<T>, critical = false): Promise<T | null> {
  const started = Date.now();
  try { const value = await fn(); (results.steps as unknown[]).push({ name, ok: true, ms: Date.now() - started }); mark(name); return value; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (results.steps as unknown[]).push({ name, ok: false, ms: Date.now() - started, error: message.slice(0, 400) });
    console.log(`  FAILED ${name}: ${message.slice(0, 400)}`);
    if (critical) throw error;
    return null;
  }
}
const save = () => writeFileSync(out, JSON.stringify({ ...results, marks }, null, 2));

const dataDir = mkdtempSync(join(tmpdir(), "omb-ibx-live-"));
const packageFile = resolve(option("--package") ?? "release/home/omb-home.tgz");
const sha256 = createHash("sha256").update(readFileSync(packageFile)).digest("hex");
const ibx = createInstaboxProvider({ apiKey: ibxKey, scope });
const boat = withBoat ? createBoatProvider({ apiKey: boatKey!, baseUrl: boatBase, scope }) : null;
// the synthetic engine (test tooling only): the claude CLI's stream surface, bundled to one file the machine's node runs
const engineFile = join(dataDir, "fake-claude.mjs");
execFileSync(resolve("node_modules/.bin/esbuild"), ["server/testing/fake-claude-cli.ts", "--bundle", "--platform=node", "--format=esm", `--outfile=${engineFile}`, "--log-level=error",
  "--banner:js=import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"], { stdio: "inherit" });

// the account service's own fetch, except the entitlement push this run cannot sign for a release home
const realFetch = globalThis.fetch;
const serviceFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname === "/api/cloud/entitlement") return new Response(JSON.stringify({ ok: true, expiresAt: Date.now() + 86_400_000 }), { status: 200, headers: { "content-type": "application/json" } });
  return realFetch(input, init);
};
const sealKey = randomBytes(32).toString("base64url"), edgeToken = randomBytes(32).toString("base64url");
const store = createStore(dataDir);
const account = { id: "acct_live", email: "live@example.test" };
const billing = createBilling({ dataDir, publicUrl: "https://dashboard.live.invalid", dashboard: { state: store.state, changed: () => store.changed() }, fetch: serviceFetch,
  accounts: { fromCookie: () => account, fromBearer: () => account },
  mail: (cloud, letter) => note(`notice to owner: ${letter.subject} for ${cloud.id}`),
  alert: entry => note(`ALERT ${entry.action} ${entry.cloudId} (${entry.reason})`),
  env: { DUSK_BILLING_PROVIDER: "fake", DUSK_CLOUD_SEAL_KEY: sealKey, DUSK_MANAGED: "1", DUSK_MANAGED_EDGE_TOKEN: edgeToken,
    DUSK_MANAGED_HOSTS: withBoat ? "instabox,boat" : "instabox", DUSK_MANAGED_HOST: "instabox", INSTABOX_API_KEY: ibxKey, ...(withBoat ? { BOAT_API_KEY: boatKey, BOAT_BASE_URL: boatBase } : {}),
    DUSK_MANAGED_SCOPE: scope, DUSK_MANAGED_KINDS: "shared_s", DUSK_MANAGED_HOME_PACKAGE_FILE: packageFile, DUSK_MANAGED_HOME_PACKAGE_SHA256: sha256,
    DUSK_MANAGED_LEASE_HOURS: "1", DUSK_MANAGED_IDLE_MINUTES: "3", DUSK_MANAGED_LOST_AFTER_MINUTES: "2", DUSK_POOL_DRIVER: "fake",
    DUSK_MANAGED_TEST_HARNESS: "1", DUSK_ENTITLEMENT_SIGNING_KEY: generateEntitlementSigner("live-test").env } });
const managed = () => billing.clouds.managed!;

async function reconcileUntil(cloudId: string, done: () => boolean, limitMs: number, label: string, pauseMs = 3000) {
  const deadline = Date.now() + limitMs;
  while (!done()) {
    const c = billing.clouds.get(cloudId)!;
    if (Date.now() > deadline) throw new Error(`${label}: timed out (status ${c.status}, step ${c.setupStep}, error ${c.error}, migration ${c.managed?.migration?.phase ?? "-"} ${c.managed?.migration?.error ?? ""})`);
    c.nextAttemptAt = 0;
    await billing.clouds.reconcile();
    if (!done()) await sleep(pauseMs);
  }
}
/** a command on the machine the cloud runs on now, through its own provider */
async function onMachine(cloudId: string, command: string, timeoutSeconds = 300) {
  const c = billing.clouds.get(cloudId)!, host = c.managed?.host ?? "boat";
  const provider = host === "instabox" ? ibx : boat!;
  return provider.run(c.serverId!, command, timeoutSeconds);
}
/** the RFB banner of the desktop stream, through the home's own origin with the person's session */
function rfbBanner(origin: string, path: string, token: string): Promise<{ banner: string; ms: number }> {
  return new Promise((resolveBanner, reject) => {
    const started = Date.now(), url = new URL(path, origin);
    const req = https.request(url, { headers: { authorization: `Bearer ${token}`, connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": randomBytes(16).toString("base64"), "sec-websocket-protocol": "binary" }, timeout: 30_000 });
    req.on("upgrade", (_res, socket) => {
      socket.once("data", (frame: Buffer) => {
        // one server frame: 2 bytes of header (+2 or +8 of length), unmasked payload
        const len = frame[1]! & 0x7f, offset = len === 126 ? 4 : len === 127 ? 10 : 2;
        resolveBanner({ banner: frame.subarray(offset).toString("latin1").trim(), ms: Date.now() - started }); socket.destroy();
      });
    });
    req.on("response", res => { reject(new Error(`viewer answered HTTP ${res.statusCode}`)); res.resume(); });
    req.on("error", reject); req.on("timeout", () => req.destroy(new Error("viewer timed out")));
    req.end();
  });
}

// what a bot's browser does on everyday sites, inside its own computer (the bot desktop container's Chromium, its network)
const SITES: Array<{ id: string; kind: string; url: string; expect?: string }> = [
  { id: "search-ddg", kind: "search", url: "https://duckduckgo.com/html/?q=weather+in+lisbon", expect: "result" },
  { id: "search-google", kind: "search", url: "https://www.google.com/search?q=weather+in+lisbon&hl=en", expect: "weather" },
  { id: "search-bing", kind: "search", url: "https://www.bing.com/search?q=weather+in+lisbon", expect: "weather" },
  { id: "news-bbc", kind: "news", url: "https://www.bbc.com/news", expect: "news" },
  { id: "news-reuters", kind: "news", url: "https://www.reuters.com/", expect: "reuters" },
  { id: "news-guardian", kind: "cookie banner", url: "https://www.theguardian.com/international", expect: "guardian" },
  { id: "shop-amazon", kind: "shopping", url: "https://www.amazon.com/dp/B0BSHF7WHW", expect: "amazon" },
  { id: "shop-ebay", kind: "shopping", url: "https://www.ebay.com/sch/i.html?_nkw=usb+c+cable", expect: "usb" },
  { id: "login-github", kind: "login form (not submitted)", url: "https://github.com/login", expect: "password" },
  { id: "js-figma", kind: "heavy JavaScript", url: "https://www.airbnb.com/", expect: "airbnb" },
  { id: "js-maps", kind: "heavy JavaScript", url: "https://www.openstreetmap.org/#map=12/38.7223/-9.1393", expect: "openstreetmap" },
  { id: "video-youtube", kind: "video", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", expect: "youtube" },
  { id: "video-vimeo", kind: "video", url: "https://vimeo.com/76979871", expect: "vimeo" },
  { id: "wiki", kind: "reference", url: "https://en.wikipedia.org/wiki/Lisbon", expect: "lisbon" },
];
const BROWSE = String.raw`
import json, os, re, shutil, subprocess, sys, time, urllib.request
sites = json.loads(sys.argv[1]); out = []
chrome = shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
walls = re.compile(r"(unusual traffic|are you a robot|not a robot|verify you are human|captcha|access denied|request blocked|sign in to confirm you.re not a bot|pardon our interruption|enable javascript and cookies|attention required)", re.I)
consent = re.compile(r"(accept all|accept cookies|cookie settings|we use cookies|manage cookies|consent)", re.I)
for s in sites:
    t = time.time()
    try:
        p = subprocess.run([chrome, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--user-data-dir=/tmp/omb-browse", "--lang=en-US",
            "--virtual-time-budget=10000", "--timeout=40000", "--dump-dom", s["url"]], capture_output=True, timeout=60)
        dom = p.stdout.decode("utf-8", "replace"); ms = int((time.time() - t) * 1000)
        title = re.search(r"<title[^>]*>(.*?)</title>", dom, re.S | re.I)
        out.append({"id": s["id"], "kind": s["kind"], "ms": ms, "bytes": len(dom), "title": (title.group(1).strip()[:80] if title else ""), "wall": bool(walls.search(dom[:400000])),
            "consent": bool(consent.search(dom[:400000])), "expected": s.get("expect", "").lower() in dom.lower(), "inputs": len(re.findall(r"<input", dom, re.I)), "exit": p.returncode})
    except Exception as e:
        out.append({"id": s["id"], "kind": s["kind"], "ms": int((time.time() - t) * 1000), "error": str(e)[:160]})
# a download into the bot's Downloads folder, and its speed
d = os.path.expanduser("~/Downloads"); os.makedirs(d, exist_ok=True); t = time.time()
try:
    urllib.request.urlretrieve("https://proof.ovh.net/files/10Mb.dat", os.path.join(d, "omb-download-test.dat"))
    size = os.path.getsize(os.path.join(d, "omb-download-test.dat")); s = time.time() - t
    out.append({"id": "download", "kind": "download", "ms": int(s * 1000), "bytes": size, "mbit": round(size * 8 / s / 1e6, 1)})
except Exception as e:
    out.append({"id": "download", "kind": "download", "error": str(e)[:160]})
print(json.dumps(out))
`;
const PROFILE = String.raw`
import json, re, shutil, subprocess, sys
chrome = shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
url = sys.argv[1]
p = subprocess.run([chrome, "--headless=new", "--no-sandbox", "--disable-gpu", "--user-data-dir=" + sys.argv[2], "--virtual-time-budget=5000", "--dump-dom", url], capture_output=True, timeout=60)
print(json.dumps({"kept": "omb_profile" in p.stdout.decode("utf-8", "replace"), "exit": p.returncode}))
`;

let failed: string | null = null;
let cloudId = "";
const sessionToken = { value: "" };
try {
  mark("start");
  // 1. paid: a fake checkout completes and its signed webhooks activate the cloud
  const answer = await billing.service.checkout(account, { kind: "cart", cart: { interval: "month", license: { kind: "none" }, desktop: { kind: "shared_s", region: "fsn1" } } } as never, { source: "live" } as never) as { cloudId: string };
  const checkout = (JSON.parse(readFileSync(join(dataDir, "billing.json"), "utf8")) as { checkouts: Array<{ providerSessionId: string | null; cloudId: string | null }> }).checkouts.at(-1)!;
  const { createServer } = await import("node:http");
  const hooks = createServer((req, res) => void (async () => { const url = new URL(req.url ?? "/", "http://127.0.0.1"); if (await billing.handle(req, res, url)) return; res.writeHead(404); res.end(); })());
  await new Promise<void>(r => hooks.listen(0, "127.0.0.1", r));
  const hookBase = `http://127.0.0.1:${(hooks.address() as { port: number }).port}`;
  for (const delivery of billing.fake!.complete(checkout.providerSessionId!)) {
    const res = await fetch(`${hookBase}/v1/billing/webhooks/dodo`, { method: "POST", headers: { "content-type": "application/json", ...delivery.headers }, body: new Uint8Array(delivery.body) });
    if (!res.ok) throw new Error(`webhook refused: ${res.status}`);
  }
  hooks.close();
  cloudId = answer.cloudId ?? checkout.cloudId!;
  const cloud = () => billing.clouds.get(cloudId)!;
  note(`cloud ${cloudId} host=${cloud().managed?.host} spec=${JSON.stringify(cloud().spec)}`);
  mark("paid and activated");

  // 2. provisioned on InstaBox through the real lifecycle and the signed package
  const provisioned = Date.now();
  await step("provision: machine created and set up", () => reconcileUntil(cloudId, () => cloud().setupStep === "starting", 30 * 60_000, "setup"), true);
  results.machine = cloud().serverId; results.setupMs = Date.now() - provisioned;
  const env = await onMachine(cloudId, `sudo sed -i '/^DUSK_CLOUD_ENTITLEMENT=/d' ${CLOUD_HOME.etc}/home.env && echo patched`);
  note(`test-only: boot env without the entitlement requirement: ${env.stdout.trim()}`);
  await step("provision: home started and healthy", () => reconcileUntil(cloudId, () => cloud().status === "running", 15 * 60_000, "start"), true);
  results.provisionMs = Date.now() - provisioned;
  note(`origin ${cloud().origin} machine ${cloud().serverId} in ${((Date.now() - provisioned) / 1000).toFixed(0)} s`);
  const facts = await onMachine(cloudId, "nproc; free -m | awk '/Mem/ {print $2\" MiB\"}'; df -h /data | tail -1; stat -c '%U %a' /data; ls /data; systemctl is-active omb-home omb-docker-gate; docker version --format '{{.Server.Version}}'");
  results.machineFacts = facts.stdout.trim().split("\n"); note(`machine: ${facts.stdout.trim().replace(/\n/g, " | ")}`);

  // the synthetic engine, so bots answer (test tooling only, never part of the product install)
  await step("engine: synthetic engine installed", async () => {
    const wrapper = `#!/bin/sh\nif [ "$1" = auth ]; then echo '{"loggedIn":true,"email":"person@example.test"}'; exit 0; fi\nexport FAKE_CLAUDE_VERSION=2.1.284\nexec ${CLOUD_HOME.root}/node/bin/node /opt/omb-test/fake-claude.mjs "$@"\n`;
    await ibx.upload(cloud().serverId!, "/data/home/fake-claude.mjs", readFileSync(engineFile));
    await ibx.upload(cloud().serverId!, "/data/home/claude-wrapper.sh", Buffer.from(wrapper));
    const done = await onMachine(cloudId, "sudo install -d -m 0755 /opt/omb-test && sudo install -m 0755 /data/home/fake-claude.mjs /opt/omb-test/fake-claude.mjs && sudo install -m 0755 /data/home/claude-wrapper.sh /usr/local/bin/claude && sudo systemctl restart omb-home && for i in $(seq 1 60); do curl -fsS -m 2 http://127.0.0.1:8799/api/health >/dev/null && break; sleep 1; done && echo ok", 180);
    if (!done.stdout.includes("ok")) throw new Error(`engine install: ${done.stdout.slice(-200)}`);
  });

  // test-only: the bot desktop image, built on the machine from the package's own Dockerfile when the registry refuses it
  if (args.includes("--prebuild-desktop")) await step("computers: bot desktop image built on the machine (test-only)", async () => {
    const started = await onMachine(cloudId, `cd ${CLOUD_HOME.root}/app/deploy/bot-desktop && (setsid nohup sh build.sh > /data/home/omb-desktop-build.log 2>&1; echo "exit $?" >> /data/home/omb-desktop-build.log) < /dev/null > /dev/null 2>&1 & echo started`, 60);
    if (!started.stdout.includes("started")) throw new Error("the image build did not start");
    for (let n = 0; n < 160; n++) {
      await sleep(15_000);
      const log = (await onMachine(cloudId, "tail -n 3 /data/home/omb-desktop-build.log", 30)).stdout;
      if (/exit \d+/.test(log)) { results.desktopImageBuild = log.trim().split("\n"); if (!/exit 0/.test(log)) throw new Error(`build failed: ${log.slice(-300)}`); return; }
    }
    throw new Error("the image build did not finish in 40 minutes");
  });

  // 3. paired as the app pairs, then three bots made and messaged
  const target = { origin: cloud().origin!, grant: () => billing.clouds.pair(account.id, cloudId) };
  const session = await step("pair: the owner's app signs in", async () => {
    const paired = await (async () => {
      const grant = await target.grant();
      const res = await fetch(`${target.origin}/api/auth/pair`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ code: grant.code, label: "InstaBox live" }) });
      const body = await res.json() as { token?: string }; if (!body.token) throw new Error(`pair ${res.status}`); sessionToken.value = body.token; return body.token;
    })();
    void paired;
    return openOwnerSession(target, fetch, { label: "InstaBox live api", background: false });
  }, true);
  const api = session!;
  const bots: Array<{ id: string; threadId: string; name: string }> = [];
  await step("bots: three made and each answers", async () => {
    const latency: number[] = [];
    for (const name of ["Ada", "Bo", "Cy"]) {
      const made = await api.call("POST", "/api/bots", { name });
      if (made.status >= 300) throw new Error(`create ${name}: ${made.status}`);
      const bot = { id: made.body?.bot?.id as string, threadId: made.body?.bot?.threadId as string, name };
      bots.push(bot);
      const sentAt = Date.now();
      await api.call("POST", `/api/bots/${bot.id}/messages`, { text: `hello ${name}, from the InstaBox run`, threadId: bot.threadId });
      let reply: string | null = null;
      for (let n = 0; n < 60 && !reply; n++) {
        await sleep(1000);
        const rows = await api.call("GET", `/api/threads/${bot.threadId}/messages?limit=20`);
        reply = ((rows.body?.messages ?? []) as Array<{ role?: string; kind?: string; text?: string }>).find(m => m.role === "bot" && m.kind === "text" && m.text?.trim())?.text ?? null;
      }
      if (!reply) throw new Error(`${name} did not answer`);
      latency.push(Date.now() - sentAt);
    }
    results.replyMs = latency;
  });

  // 4. their computers on this same machine: each bot's own desktop, side by side
  const computers: Record<string, { ms: number; ok: boolean; problem?: string }> = {};
  await step("computers: each bot's desktop woken on the machine", async () => {
    for (const bot of bots) {
      const set = await api.call("PATCH", `/api/bots/${bot.id}`, { computer: "cloud" });
      const started = Date.now();
      const woke = await api.call("POST", `/api/bots/${bot.id}/computer/provision`, {});
      computers[bot.name] = { ms: Date.now() - started, ok: woke.status < 300 && woke.body?.ready === true, ...(woke.status >= 300 ? { problem: `${set.status}/${woke.status} ${JSON.stringify(woke.body).slice(0, 200)}` } : {}) };
      note(`computer for ${bot.name}: ${JSON.stringify(computers[bot.name])}`);
    }
    results.computers = computers;
    const mem = await onMachine(cloudId, "free -m | awk '/Mem/ {print $3\"/\"$2\" MiB used\"}'; sudo docker ps --format '{{.Names}} {{.Status}}' | head");
    results.memoryWithComputers = mem.stdout.trim().split("\n");
    if (!Object.values(computers).some(x => x.ok)) throw new Error("no computer came up");
  });
  const first = bots.find(b => computers[b.name]?.ok) ?? bots[0]!;
  await step("desktop: the stream opens through the home's origin", async () => {
    const shot = await api.call("POST", `/api/bots/${first.id}/computer/screenshot`, {});
    results.screenshotBytes = JSON.stringify(shot.body ?? {}).length;
    const join = await api.call("POST", `/api/bots/${first.id}/computer/join?viewer=proxy`, {});
    const joinUrl = String(join.body?.joinUrl ?? "");
    if (!joinUrl) throw new Error(`join ${join.status} ${JSON.stringify(join.body).slice(0, 200)}`);
    const path = new URL(joinUrl, cloud().origin!).pathname.replace(/\/?$/, "/websockify");
    const banner = await rfbBanner(cloud().origin!, path, sessionToken.value);
    results.desktopStream = banner; note(`desktop stream: ${JSON.stringify(banner)}`);
    if (!banner.banner.startsWith("RFB")) throw new Error(`not an RFB stream: ${banner.banner}`);
  });

  // 5. the bot's browser on everyday sites, from inside its computer
  const container = async () => (await onMachine(cloudId, "sudo docker ps --format '{{.ID}} {{.Names}}' | grep -i -m1 -E 'omb|bot|desktop' | cut -d' ' -f1")).stdout.trim();
  await step("browser: everyday websites from a bot's computer", async () => {
    const id = await container();
    if (!id) throw new Error("no bot desktop container");
    await ibx.upload(cloud().serverId!, "/data/home/omb-browse.py", Buffer.from(BROWSE));
    const run = await onMachine(cloudId, `sudo docker cp /data/home/omb-browse.py ${id}:/tmp/omb-browse.py && sudo docker exec -u 1000 ${id} python3 /tmp/omb-browse.py '${JSON.stringify(SITES).replace(/'/g, "")}'`, 600);
    const parsed = JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "[]");
    results.browse = parsed;
    for (const r of parsed) note(`${r.id.padEnd(14)} ${String(r.ms).padStart(6)} ms ${r.error ? `ERROR ${r.error}` : `${r.bytes} bytes${r.wall ? " WALL" : ""}${r.consent ? " consent" : ""}${r.expected ? "" : " unexpected"} ${r.title ?? ""}${r.mbit ? ` ${r.mbit} Mbit/s` : ""}`}`);
  });
  await step("browser: the same sites from the machine itself (address reputation)", async () => {
    const cmd = SITES.map(s => `printf '%s ' ${s.id}; curl -s -o /dev/null -m 30 -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36' -w '%{http_code} %{time_total}\\n' '${s.url}'`).join("; ");
    const run = await onMachine(cloudId, cmd, 600);
    results.curlInstabox = run.stdout.trim().split("\n");
    const ip = await onMachine(cloudId, "curl -s -m 10 https://ipinfo.io/json | tr -d '\\n' | head -c 400");
    results.egressInstabox = ip.stdout.replace(/"ip":\s*"[^"]+"/, "\"ip\":\"(withheld)\"");
  });
  await step("clipboard and files inside the bot's computer", async () => {
    const id = await container();
    const clip = await onMachine(cloudId, `sudo docker exec -u 1000 -e DISPLAY=:1 ${id} sh -c 'printf omb-clip | (xclip -selection clipboard 2>/dev/null || xsel -bi) && sleep 1 && (xclip -o -selection clipboard 2>/dev/null || xsel -bo)'`);
    results.clipboard = clip.stdout.trim() === "omb-clip" ? "copy and paste work" : `clipboard: ${clip.stdout.trim().slice(0, 80) || "no tool"}`;
    const file = await onMachine(cloudId, `sudo docker exec -u 1000 ${id} sh -c 'echo omb-file-$(date +%s) > ~/Desktop/omb-note.txt 2>/dev/null || echo omb-file-$(date +%s) > ~/omb-note.txt; cat ~/Desktop/omb-note.txt ~/omb-note.txt 2>/dev/null | head -1; ls ~/Downloads | head'`);
    results.filesInComputer = file.stdout.trim().split("\n");
    // a file in the home's own data, the layer migrations carry
    const data = await onMachine(cloudId, `sudo -u maus sh -c 'mkdir -p ${CLOUD_HOME.data}/workspaces/${first.id} && echo "kept across everything" > ${CLOUD_HOME.data}/workspaces/${first.id}/omb-live-note.md' && sudo cat ${CLOUD_HOME.data}/workspaces/${first.id}/omb-live-note.md`);
    results.fileInData = data.stdout.trim();
  });
  await step("browser profile: a site's cookie kept in the bot's profile", async () => {
    const id = await container();
    await ibx.upload(cloud().serverId!, "/data/home/omb-profile.py", Buffer.from(PROFILE));
    await onMachine(cloudId, `sudo docker cp /data/home/omb-profile.py ${id}:/tmp/omb-profile.py`);
    await onMachine(cloudId, `sudo docker exec -u 1000 ${id} python3 /tmp/omb-profile.py 'https://httpbin.org/cookies/set?omb_profile=kept' /home/cua/.omb-profile 2>/dev/null || sudo docker exec -u 1000 ${id} python3 /tmp/omb-profile.py 'https://httpbin.org/cookies/set?omb_profile=kept' /tmp/omb-profile`, 120);
    const check = await onMachine(cloudId, `sudo docker exec -u 1000 ${id} sh -c 'd=/home/cua/.omb-profile; [ -d $d ] || d=/tmp/omb-profile; python3 /tmp/omb-profile.py https://httpbin.org/cookies $d'`, 120);
    results.profileBefore = check.stdout.trim();
  });

  // 6. paused with memory, left a few minutes, resumed for its owner
  const memoryMark = await onMachine(cloudId, `id=$(sudo docker ps -q | head -1); sudo docker exec -d $id sh -c 'sleep 100000' ; sleep 1; sudo docker inspect -f '{{.State.StartedAt}}' $id; sudo docker exec $id sh -c 'pgrep -f "sleep 100000" | head -1'; cat /proc/sys/kernel/random/boot_id`);
  const [startedAtBefore, pidBefore, bootBefore] = memoryMark.stdout.trim().split("\n");
  await step("pause: the owner puts it to sleep (memory kept)", async () => {
    const asked = Date.now();
    await billing.clouds.power(account.id, cloudId, "off");
    await reconcileUntil(cloudId, () => cloud().status === "sleeping", 10 * 60_000, "sleep", 1000);
    for (let n = 0; n < 60 && (await ibx.machine(cloud().serverId!))?.state !== "stopped"; n++) await sleep(1000);
    results.pauseMs = Date.now() - asked;
    const status = await fetch(`${cloud().origin}/api/health`).then(r => r.status).catch(() => 0);
    results.originWhilePaused = status;
  });
  note("left paused for 3 minutes");
  await sleep(3 * 60_000);
  await step("resume: the owner wakes it and it continues where it was", async () => {
    const asked = Date.now();
    await billing.clouds.power(account.id, cloudId, "on");
    await reconcileUntil(cloudId, () => cloud().status === "running", 10 * 60_000, "wake", 500);
    results.resumeMs = Date.now() - asked;
    const after = await onMachine(cloudId, `id=$(sudo docker ps -q | head -1); sudo docker inspect -f '{{.State.StartedAt}}' $id; sudo docker exec $id sh -c 'pgrep -f "sleep 100000" | head -1'; cat /proc/sys/kernel/random/boot_id`);
    const [startedAtAfter, pidAfter, bootAfter] = after.stdout.trim().split("\n");
    results.memoryKept = { sameBoot: bootBefore === bootAfter, containerNotRestarted: startedAtBefore === startedAtAfter, processAlive: !!pidBefore && pidBefore === pidAfter };
    const list = await api.call("GET", "/api/bots?messages=0");
    results.botsAfterResume = (list.body?.bots ?? []).map((b: { name?: string }) => b.name);
    const sentAt = Date.now();
    await api.call("POST", `/api/bots/${bots[0]!.id}/messages`, { text: "still there after the pause?", threadId: bots[0]!.threadId });
    for (let n = 0; n < 60; n++) {
      await sleep(1000);
      const rows = await api.call("GET", `/api/threads/${bots[0]!.threadId}/messages?limit=30`);
      if (((rows.body?.messages ?? []) as Array<{ role?: string; kind?: string }>).filter(m => m.role === "bot" && m.kind === "text").length >= 2) { results.replyAfterResumeMs = Date.now() - sentAt; break; }
    }
    const id = await container();
    const check = await onMachine(cloudId, `sudo docker exec -u 1000 ${id} sh -c 'd=/home/cua/.omb-profile; [ -d $d ] || d=/tmp/omb-profile; python3 /tmp/omb-profile.py https://httpbin.org/cookies $d'`, 120);
    results.profileAfterResume = check.stdout.trim();
  });

  if (!args.includes("--focus") || option("--focus") !== "computers") {
  // 7. a routine due while the home sleeps: woken before it, it runs on time
  await step("routine: runs on time across a pause", async () => {
    const due = Date.now() + 6 * 60_000;
    const made = await api.call("POST", "/api/routines", { name: "Across the pause", prompt: "Say the time.", botId: bots[0]!.id, enabled: true, schedule: { type: "once", at: due } });
    if (made.status >= 300) throw new Error(`routine ${made.status} ${JSON.stringify(made.body).slice(0, 200)}`);
    const routineId = made.body.routine.id as string;
    cloud().managed!.lastPowerAt = 0; cloud().nextAttemptAt = 0; await billing.clouds.reconcile();
    note(`home reports next due ${cloud().managed!.nextDueAt ? new Date(cloud().managed!.nextDueAt!).toISOString() : "none"}`);
    await billing.clouds.power(account.id, cloudId, "off");
    await reconcileUntil(cloudId, () => cloud().status === "sleeping", 10 * 60_000, "sleep before the routine", 1000);
    const sleptAt = Date.now();
    await reconcileUntil(cloudId, () => cloud().status === "running", 12 * 60_000, "woken for the routine", 5000);
    const wokeAt = Date.now();
    let run: { status?: string; startedAt?: number; finishedAt?: number } | undefined;
    for (let n = 0; n < 90 && run?.status !== "completed"; n++) {
      await sleep(5000);
      const list = await api.call("GET", "/api/routines");
      run = (list.body?.runs ?? []).find((r: { routineId?: string }) => r.routineId === routineId);
    }
    results.routine = { dueAt: new Date(due).toISOString(), sleptMs: wokeAt - sleptAt, wokeBeforeDueMs: due - wokeAt, run: run ? { status: run.status, lateMs: run.startedAt ? run.startedAt - due : null } : null,
      wakeReason: billing.clouds.get(cloudId)?.managed?.power ? "routine" : null };
    if (run?.status !== "completed") throw new Error(`routine run ${run?.status ?? "missing"}`);
  });

  // 8. crashes: the home's process killed, then the whole machine rebooted hard
  await step("crash: the home process is killed and comes back", async () => {
    const killedAt = Date.now();
    await onMachine(cloudId, "sudo systemctl kill -s KILL omb-home.service; echo killed");
    for (let n = 0; n < 120; n++) { const ok = await fetch(`${cloud().origin}/api/health`).then(r => r.ok).catch(() => false); if (ok && Date.now() - killedAt > 2000) break; await sleep(1000); }
    results.processRecoveryMs = Date.now() - killedAt;
  });
  await step("crash: the machine reboots hard and the home comes back by itself", async () => {
    const rebootedAt = Date.now();
    await onMachine(cloudId, "(sleep 1; sudo reboot -f) >/dev/null 2>&1 & echo rebooting", 30).catch(() => null);
    await sleep(5000);
    for (let n = 0; n < 240; n++) { const ok = await fetch(`${cloud().origin}/api/health`).then(r => r.ok).catch(() => false); if (ok) break; await sleep(1000); }
    results.machineRecoveryMs = Date.now() - rebootedAt;
    const boot = await onMachine(cloudId, "cat /proc/sys/kernel/random/boot_id; sudo docker ps --format '{{.Names}} {{.Status}}' | head -3");
    results.afterReboot = boot.stdout.trim().split("\n");
    const list = await api.call("GET", "/api/bots?messages=0");
    results.botsAfterReboot = (list.body?.bots ?? []).map((b: { name?: string }) => b.name);
  });

  // 9. a bot moved here from a local fixture with the app's own send (the Mac-to-cloud move)
  await step("move in: a bot from a local fixture arrives with its chat", async () => {
    const local = await launchVerificationServer({ ...process.env, DUSK_TEST_PORTS: "19975-19999", FAKE_CLAUDE_VERSION: "2.1.284" });
    try {
      const localApi = (route: string, init?: RequestInit) => fetch(`${local.info.url}${route}`, init);
      const mine = await (await localApi("/api/bots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Moved from the Mac" }) })).json() as { bot: { id: string; threadId: string } };
      await localApi(`/api/bots/${mine.bot.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "a chat that should move with me", threadId: mine.bot.threadId }) });
      await sleep(8000);
      const reader = await openOwnerSession(target, fetch, { label: "InstaBox live read", background: true });
      let kept: unknown = null;
      const send = createCloudSend({
        local: (route: string, init?: RequestInit) => localApi(route, init),
        cloud: { origin: () => target.origin, asleep: () => false, read: (route: string) => reader.fetch!(route), open: () => openOwnerSession(target, fetch, { label: "InstaBox live move", background: false }) },
        handoff: async () => { throw new Error("no sign-ins in this run"); },
        store: { read: () => kept, write: (value: unknown) => { kept = value; } },
      });
      const started = Date.now();
      await send.send({ reason: "button" });
      const there = await api.call("GET", "/api/bots?messages=0");
      const moved = (there.body?.bots ?? []).find((b: { name?: string }) => b.name === "Moved from the Mac");
      const rows = moved?.threadId ? await api.call("GET", `/api/threads/${moved.threadId}/messages?limit=20`) : null;
      results.moveIn = { arrived: Boolean(moved), rows: (rows?.body?.messages ?? []).length, ms: Date.now() - started };
      if (!moved) throw new Error("the moved bot did not arrive");
    } finally { await local.close().catch(() => {}); }
  });

  // 10. the home moved to Boat by the operator, checked there, then rolled back on purpose
  if (withBoat && !args.includes("--skip-move")) {
    const ibxMachine = cloud().serverId!;
    const pidMark = await onMachine(cloudId, `id=$(sudo docker ps -q | head -1); sudo docker exec -d $id sh -c 'sleep 200000'; sleep 1; sudo docker exec $id sh -c 'pgrep -f "sleep 200000" | head -1'`);
    await step("migrate: InstaBox to Boat, checked file by file", async () => {
      const started = Date.now();
      managed().migrate!(cloud(), "boat");
      const phases: Record<string, number> = {};
      await reconcileUntil(cloudId, () => { const p = cloud().managed!.migration!.phase; phases[p] ??= Date.now() - started; return p === "done" || p === "rolled_back"; }, 40 * 60_000, "migrate to boat", 3000);
      const m = cloud().managed!.migration!;
      results.migrateToBoat = { phase: m.phase, phases, checked: m.checked, error: m.error, ms: Date.now() - started, boatMachine: cloud().serverId };
      if (m.phase !== "done") throw new Error(`migration ended ${m.phase}: ${m.error}`);
      const there = await openOwnerSession({ origin: cloud().origin!, grant: () => billing.clouds.pair(account.id, cloudId) }, fetch, { label: "on Boat", background: true });
      const list = await there.call("GET", "/api/bots?messages=0");
      results.botsOnBoat = (list.body?.bots ?? []).map((b: { name?: string }) => b.name);
      const note = await onMachine(cloudId, `sudo cat ${CLOUD_HOME.data}/workspaces/${first.id}/omb-live-note.md`);
      results.fileOnBoat = note.stdout.trim();
      const cmd = SITES.map(s => `printf '%s ' ${s.id}; curl -s -o /dev/null -m 30 -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36' -w '%{http_code} %{time_total}\\n' '${s.url}'`).join("; ");
      results.curlBoat = (await onMachine(cloudId, cmd, 600)).stdout.trim().split("\n");
    });
    await step("rollback: back to the InstaBox machine on purpose, its memory intact", async () => {
      const started = Date.now();
      managed().rollbackMigration!(cloud());
      await reconcileUntil(cloudId, () => cloud().managed!.migration!.phase === "rolled_back" && cloud().status === "running", 30 * 60_000, "roll back", 3000);
      const m = cloud().managed!.migration!;
      const alive = await onMachine(cloudId, `id=$(sudo docker ps -q | head -1); sudo docker exec $id sh -c 'pgrep -f "sleep 200000" | head -1'`);
      results.rollback = { ms: Date.now() - started, backOn: cloud().serverId, sameMachine: cloud().serverId === ibxMachine, processAlive: alive.stdout.trim() === pidMark.stdout.trim() && !!alive.stdout.trim(),
        keptBackup: cloud().managed!.backups.some(g => g.keep), target: m.target };
      const list = await api.call("GET", "/api/bots?messages=0");
      results.botsAfterRollback = (list.body?.bots ?? []).map((b: { name?: string }) => b.name);
      await managed().finishMigration!(cloud());
      results.finished = cloud().managed!.migration!.deleted ?? null;
    });
  }

  }
  // 11. what InstaBox measured and billed for this machine
  await step("usage: the provider's own numbers", async () => {
    const usage = await ibx.usage!(cloud().serverId!);
    results.usage = usage ? { ...usage, cents: instaboxUsageCents(usage) } : null;
    results.lifecycleAudit = JSON.parse(`[${readFileSync(join(dataDir, "boat-audit.jsonl"), "utf8").trim().split("\n").join(",")}]`).map((e: { action: string; reason: string; at: number }) => `${new Date(e.at).toISOString().slice(11, 19)} ${e.action}:${e.reason}`);
  });
} catch (error) {
  failed = error instanceof Error ? error.message : String(error);
  console.error(`FAILED: ${failed}`);
} finally {
  // teardown: every machine under this run's scope on both providers, deleted and proven gone
  results.failed = failed;
  const deleted: string[] = [];
  for (const [name, provider] of [["instabox", ibx], ...(boat ? [["boat", boat]] as const : [])] as const) {
    for (let round = 0; round < 3; round++) {
      const left = await provider.inventory().catch(() => []);
      for (const m of left) { const r = await provider.requestDelete(m.id).catch(e => ({ error: String(e) })); deleted.push(`${name}:${m.id}:${JSON.stringify(r).slice(0, 80)}`); }
      if (!left.length) break;
      await sleep(10_000);
    }
  }
  results.teardown = deleted;
  await sleep(15_000);
  results.leftInstabox = (await ibx.inventory().catch(() => [{ id: "unknown" }])).map(m => m.id);
  results.leftBoat = boat ? (await boat.inventory().catch(() => [{ id: "unknown" }])).map(m => m.id) : [];
  results.marks = marks;
  save();
  billing.close(); store.close?.();
  rmSync(dataDir, { recursive: true, force: true });
  console.log(JSON.stringify({ failed, leftInstabox: results.leftInstabox, leftBoat: results.leftBoat }, null, 2));
  process.exit(failed ? 1 : 0);
}
