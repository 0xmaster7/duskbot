// A server's bots to dusk cloud from an app that is not signed in to its dusk bot account (the owner's report: the
// checkout sheet said "sign in on this Mac's own page first"). A fresh app that skips the account, its own server (a
// throwaway InstaBox machine, always deleted), the server's page, Get dusk cloud: the sign-in must open right there (the
// accounts sheet in the rail's view), and after it the checkout opens by itself, is paid in Dodo TEST mode, and the move
// follows. Sink addresses only.
//
//   node scripts/smoke/flows/server-to-cloud.mjs [--out DIR] [--profile DIR] [--email ADDRESS] [--no-pay]
import { join } from "node:path";
import { testMailCode } from "../account.mjs";
import { until } from "../app.mjs";
import { payDodoTestCheckout } from "../dodo-test-pay.mjs";
import { createFlow, flowArgs, runFlow, sleep } from "./lib.mjs";
import { createVm, leftoverVms, removeVm } from "./instabox-vm.mjs";

const { root, out, profile, email, stamp, flag } = flowArgs("s2c");
const flow = createFlow({ name: "server-to-cloud", title: "server to dusk cloud, signed out", root, out, profile, email, env: { DUSK_ALLOW_SIGNED_OUT: "1" } });
const js = (value) => JSON.stringify(value);

/** another page of the app (the rail's view), driven over its own devtools socket */
async function pageAt(pathPart) {
  const target = await until(async () => (await flow.app.targets()).find((t) => t.type === "page" && t.url.includes(pathPart)), { timeout: 30_000, what: `the ${pathPart} page` });
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = () => fail(new Error("socket")); });
  let next = 0; const waiting = new Map();
  socket.onmessage = (event) => { const m = JSON.parse(String(event.data)); if (m.id) { waiting.get(m.id)?.(m); waiting.delete(m.id); } };
  const send = (method, params = {}) => new Promise((done, fail) => { const id = ++next; waiting.set(id, (m) => m.error ? fail(new Error(m.error.message)) : done(m.result)); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] ?? "evaluate failed"); return r.result?.value; };
  return { send, evaluate, close: () => socket.close() };
}
/** in the main window, as a person's click (user activation), awaiting the answer */
const act = async (expression) => {
  const r = await flow.app.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] ?? "failed");
  return r.result?.value;
};

let vm = null, serverOrigin = null;
await runFlow(flow, async () => {
  await flow.step("launch", "a fresh app, not signed in to an account", async () => {
    await flow.launch();
    await flow.waitText(/meet dusk bot|where should your bots live|sign in to dusk bot/i, "the welcome", { timeout: 120_000 });
    const state = await flow.accountState().catch(() => null);
    return `account: ${state?.status ?? "none"}`;
  }, { critical: true });

  let line = null;
  await flow.step("install-line", "skips the account, picks its own server", async () => {
    await flow.click("get started", { timeout: 10_000 }).catch(() => {});
    await sleep(1000);
    await flow.clickSelector("[data-funnel-account-skip]", 8_000).catch(() => {});
    await flow.waitText(/where should your bots live/i, "where should your bots live", { timeout: 30_000 });
    await flow.click("use your own server", { contains: true });
    line = await flow.waitText(/curl -fsSL https:\/\/link\.dusk\.bot\/i\/[a-z0-9-]+ \| sh( -s -- --[a-z]+)?/, "the install line", { timeout: 45_000 });
  }, { critical: true });

  await flow.step("server", "a throwaway server runs the line, and the app links it", async () => {
    for (const old of await leftoverVms()) if (Date.parse(old.createdAt ?? 0) < Date.now() - 60 * 60_000) await removeVm(old.id).catch(() => {});
    vm = await createVm(`dusk-smoke-s2c-${stamp.slice(5).replace(/[^0-9]/g, "")}`);
    const made = vm; flow.atClose(async () => { await made.remove(); flow.log(`deleted ${made.id}`); });
    await vm.exec(`cd ~ && setsid nohup bash -c ${js(`${line}; echo "exit $?" >> ~/dusk-install.log`)} > ~/dusk-install.log 2>&1 < /dev/null & echo started`, 30);
    const started = Date.now();
    for (;;) {
      const v = await flow.evaluate(`window.duskDesktop?.vpsLink?.state()`).catch(() => null);
      if (v && ["linked", "moving", "moved"].includes(v.stage)) break;
      const tail = (await vm.exec("tail -c 400 ~/dusk-install.log", 20).catch(() => ({ stdout: "" }))).stdout;
      if (/exit [1-9]/.test(tail) || /^curl: \(\d+\)/m.test(tail) && /exit 0\s*$/.test(tail)) throw new Error(`the install line failed: ${tail.replace(/\s+/g, " ").slice(-200)}`);
      if (Date.now() - started > 20 * 60_000) throw new Error("the app never saw the server");
      await sleep(10_000);
    }
    return `linked after ${Math.round((Date.now() - started) / 1000)}s`;
  }, { critical: true });

  await flow.step("server-page", "opens the server's own page", async () => {
    await flow.waitText(/is connected/i, "the connected screen", { timeout: 60_000 });
    await flow.click("open", { contains: true });
    const url = await until(async () => { const page = (await flow.app.targets()).find((t) => t.type === "page" && /^https:/.test(t.url) && !/\/rail/.test(t.url)); return page?.url; }, { timeout: 60_000, what: "the server's page" });
    serverOrigin = new URL(url).origin;
    await flow.app.reattach(serverOrigin);
    await flow.waitFor(`Boolean(window.duskDesktop?.vpsCloudMove)`, "the server page's move bridge", 60_000);
    return serverOrigin;
  }, { critical: true });

  let since = 0;
  await flow.step("get-cloud", "Get dusk cloud while signed out opens the sign-in right there (no 'sign in on this Mac's page first')", async () => {
    since = Date.now();
    let answer;
    try { answer = await act(`window.duskDesktop.vpsCloudMove.buy("pro")`); }
    catch (error) { throw new Error(`the buy refused: ${error.message}`); }
    flow.facts.afterBuy = answer;
    if (answer?.signingIn !== true) throw new Error(`the move did not wait on a sign-in: ${JSON.stringify(answer).slice(0, 160)}`);
    const rail = await pageAt("/rail");
    try {
      await until(() => rail.evaluate(`Boolean(document.querySelector("[data-sign-in-sheet]"))`), { timeout: 30_000, what: "the sign-in sheet over the server's page" });
      flow.facts.sheet = (await rail.evaluate(`document.querySelector("[data-sign-in-sheet]").innerText`)).replace(/\s+/g, " ").slice(0, 200);
      await flow.shot("sign-in-sheet");
      // the person signs in with an emailed code, in the sheet
      await rail.evaluate(`(() => { const box = document.querySelector("[data-sign-in-sheet] input[type=email]"); box.focus(); return true; })()`);
      await rail.send("Input.insertText", { text: email });
      const asked = Date.now();
      await rail.evaluate(`document.querySelector("[data-sign-in-sheet] form").requestSubmit(); true`);
      const code = await until(() => testMailCode(email, asked), { timeout: 60_000, every: 1_000, what: "the sign-in code" });
      await until(() => rail.evaluate(`Boolean(document.querySelector("[data-sign-in-sheet] input[inputmode=numeric]"))`), { what: "the code boxes" });
      await rail.evaluate(`document.querySelector("[data-sign-in-sheet] input[inputmode=numeric]").focus(); true`);
      await rail.send("Input.insertText", { text: code });
      await rail.evaluate(`document.querySelector("[data-sign-in-sheet] form")?.requestSubmit(); true`).catch(() => {});
      await until(() => rail.evaluate(`!document.querySelector("[data-sign-in-sheet]")`), { timeout: 30_000, what: "the sheet to close once signed in" });
    } finally { rail.close(); }
    return flow.facts.sheet;
  }, { critical: true });

  let checkoutUrl = null;
  await flow.step("checkout", "signed in, the checkout opens by itself", async () => {
    checkoutUrl = await until(() => flow.opened(since).find((url) => /checkout\.dodopayments\.com/.test(url)), { timeout: 90_000, what: "the checkout to open by itself" });
    if (!/^https:\/\/test\./.test(checkoutUrl)) throw new Error("the checkout is not in test mode; refusing to pay");
    const view = await flow.evaluate(`window.duskDesktop.vpsCloudMove.view()`);
    flow.facts.afterSignIn = view;
    return `opened ${new URL(checkoutUrl).host}; the sheet: ${view.stage}${view.signingIn ? " (still signing in)" : ""}`;
  }, { critical: true });

  if (flag("--no-pay")) return;
  await flow.step("pay", "pays with the test card", async () => {
    let n = 0;
    await payDodoTestCheckout(checkoutUrl, { log: flow.log, shot: (label) => join(out, `pay-${++n}-${label}.png`) });
  }, { critical: true });

  await flow.step("move", "the server's bots move to the new cloud by themselves", async () => {
    const started = Date.now(), seen = new Set();
    for (;;) {
      const view = await flow.evaluate(`window.duskDesktop?.vpsCloudMove?.view()`).catch(() => null);
      const label = view ? `${view.stage}${view.phase ? `:${view.phase}` : ""}` : "page changed";
      if (!seen.has(label)) { seen.add(label); flow.log(`move: ${label}`); }
      if (view?.stage === "done" || label === "page changed" && seen.has("moving:copy")) break;
      if (view?.stage === "failed") throw new Error(`the move failed: ${view.error}`);
      if (Date.now() - started > 15 * 60_000) throw new Error(`no move after 15 minutes (${[...seen].join(" > ")})`);
      await sleep(5000);
    }
    flow.facts.moveSteps = [...seen];
    return `${Math.round((Date.now() - started) / 1000)}s: ${[...seen].join(" > ")}`;
  });
});
