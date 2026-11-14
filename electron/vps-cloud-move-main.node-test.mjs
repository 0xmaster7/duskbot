import assert from "node:assert/strict";
import test from "node:test";
import { installVpsCloudMoveMain } from "./vps-cloud-move-main.mjs";

const VPS = { id: "place-1", kind: "remote", name: "Hetzner box", origin: "https://box.example.test" };
const ENV_ID = "0d9e8f7a-6b5c-4d3e-9f8a-7b6c5d4e3f2a";

function setup({ handoff = async () => ({ opened: true }), state = null, signIn = null, account = null } = {}) {
  const handlers = new Map(), files = new Map(), told = [], tracked = [], asked = [];
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/auth/session") return json({ kind: "session", own: true });
    if (path === "/.well-known/duskbot/environment") return json({ environmentId: ENV_ID, capabilities: { move: 1, moveOut: 1 } });
    return new Response("{}", { status: 404 });
  };
  const move = installVpsCloudMoveMain({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    pageOrigin: (event) => event.origin ?? null,
    localPage: (event) => event.local === true,
    environments: () => [VPS, { id: "cloud", kind: "remote", name: "My Cloud", origin: "https://cloud.example.test", cloud: { id: "c" } }],
    fetch,
    cloud: () => state,
    home: () => null,
    cloudRead: async () => new Response("{}", { status: 503 }),
    file: (name) => ({ read: () => files.get(name) ?? null, write: (value) => files.set(name, value) }),
    account: () => ({ webHandoff: async (options) => { asked.push(options); return handoff(options); }, ...(account ? { state: account } : {}) }),
    ...(signIn ? { signIn } : {}),
    viaMac: { available: () => false, start: async () => {}, view: () => null },
    openHome: () => {},
    track: (name, props) => tracked.push({ name, props }),
    tell: (view) => told.push(view),
    log: () => {},
  });
  const call = (channel, event, ...args) => handlers.get(channel)(event, ...args);
  return { move, call, files, told, tracked, asked };
}

test("only the saved server whose page asks is moved; any other page is refused before anything is asked", async () => {
  const { call, files } = setup();
  await assert.rejects(call("vps-cloud-move:start", { origin: "https://evil.example.test" }), /Open the server whose bots should move/);
  await assert.rejects(call("vps-cloud-move:start", { origin: "https://cloud.example.test" }), /Open the server whose bots should move/, "a Cloud place is never a source");
  await assert.rejects(call("vps-cloud-move:start", { local: true }), /Open the server/, "this computer's page only reads");
  assert.throws(() => call("vps-cloud-move:view", {}), /only available in this app's window/);
  assert.deepEqual(call("vps-cloud-move:view", { local: true }), { stage: "none", cloud: "signed-out" });
  assert.equal(files.get("vps-cloud-choice.json"), undefined);
});

test("buy first: the checkout opens signed in, as the computer move's checkout, and the move waits for its Cloud", async () => {
  const { call, files, asked, tracked } = setup({ state: { status: "connected", account: { id: "acct" } } });
  const view = await call("vps-cloud-move:buy", { origin: VPS.origin }, "not-a-plan");
  assert.deepEqual(asked, [{ plan: "pro", source: "app_computer_move" }]);
  assert.equal(view.stage, "buying");
  assert.equal(files.get("vps-cloud-choice.json").route, "direct");
  assert.deepEqual(tracked.map((entry) => [entry.name, entry.props.step]), [["vps_cloud_move", "buy"]]);
  assert.equal(call("vps-cloud-move:cancel", { origin: VPS.origin }).stage, "none", "nothing ran, so it can be let go of");
});

test("signed out, the buy says so and the page goes to sign-in", async () => {
  const { call } = setup({ handoff: async () => ({ signedOut: true }) });
  await assert.rejects(call("vps-cloud-move:buy", { origin: VPS.origin }, "pro"), /Sign in to dusk cloud first/);
});

test("asked from the rail or the dashboard, only that server's own page opens the sheet, once", () => {
  const { move, call } = setup();
  assert.equal(call("vps-cloud-move:asked", { origin: VPS.origin }), false, "nothing asked yet");
  assert.throws(() => move.ask("cloud"), /isn't in this app/, "never a Cloud");
  move.ask(VPS.id);
  assert.equal(call("vps-cloud-move:asked", { origin: "https://cloud.example.test" }), false, "another page never");
  assert.equal(call("vps-cloud-move:asked", { local: true }), false);
  assert.equal(call("vps-cloud-move:asked", { origin: VPS.origin }), true);
  assert.equal(call("vps-cloud-move:asked", { origin: VPS.origin }), false, "once");
});

test("signed out, the buy opens the sign-in right here and the checkout follows it with no other step", async () => {
  let signedIn = false, opened = 0;
  const { move, call, asked, told } = setup({ signIn: () => { opened++; }, account: () => (signedIn ? { status: "connected", account: { id: "acct" } } : { status: "signed-out" }) });
  const view = await call("vps-cloud-move:buy", { origin: VPS.origin }, "pro");
  assert.equal(opened, 1, "the sign-in opened over the page");
  assert.deepEqual(asked, [], "no checkout before the sign-in");
  assert.equal(view.stage, "buying");
  assert.equal(view.signingIn, true);
  assert.equal(call("vps-cloud-move:view", { origin: VPS.origin }).signingIn, true);
  call("vps-cloud-move:sign-in", { origin: VPS.origin });
  assert.equal(opened, 2, "Sign in opens it again");
  await move.signedInNow();
  assert.deepEqual(asked, [], "still signed out: nothing opens");
  signedIn = true;
  await move.signedInNow();
  assert.deepEqual(asked, [{ plan: "pro", source: "app_computer_move" }], "signed in: the checkout opens by itself");
  assert.equal(told.at(-1).signingIn, undefined);
  await move.signedInNow();
  assert.equal(asked.length, 1, "once");
});
