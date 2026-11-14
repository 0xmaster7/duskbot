// A server's bots to dusk cloud from an app that is not signed in to its dusk bot account (the owner's report: the
// checkout sheet said "sign in on this Mac's own page first"). A fresh app that skips the account, its own server (a
// throwaway InstaBox machine, always deleted), the server's page, Get dusk cloud: the sign-in must open right there (the
// accounts sheet in the rail's view), and after it the checkout opens by itself, is paid in Dodo TEST mode, and the move
// follows. Sink addresses only.
//
//   node scripts/smoke/flows/server-to-cloud.mjs [--out DIR] [--profile DIR] [--email ADDRESS] [--no-pay]
import { join } from "node:path";
import { until } from "../app.mjs";
import { accountLinkFrom, webAccountStep } from "./web-account.mjs";
import { createFlow, flowArgs, runFlow, sleep } from "./lib.mjs";
import { createVm, leftoverVms, removeVm } from "./instabox-vm.mjs";

const { root, out, profile, email, stamp, flag } = flowArgs("s2c");
const flow = createFlow({ name: "server-to-cloud", title: "server to dusk cloud, signed out", root, out, profile, email, env: { DUSK_ALLOW_SIGNED_OUT: "1" } });
const js = (value) => JSON.stringify(value);

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
  await flow.step("install-line", "skips the account, picks its own server; linking signs in in the browser, then the line comes", async () => {
    await flow.click("get started", { timeout: 10_000 }).catch(() => {});
    await sleep(1000);
    await flow.clickSelector("[data-funnel-account-skip]", 8_000).catch(() => {});
    await flow.waitText(/where should your bots live/i, "where should your bots live", { timeout: 30_000 });
    const since = Date.now();
    await flow.click("use your own server", { contains: true });
    // signed out: linking needs the account, so the sign-in continues in the browser and the line comes by itself after
    const signIn = await flow.waitFor(`Boolean(document.querySelector('[data-install-phase="sign-in"]'))`, "the sign-in state", 20_000).catch(() => false);
    if (signIn) {
      flow.facts.linkSignIn = (await flow.text('[data-install-phase="sign-in"]')).replace(/\s+/g, " ").slice(0, 200);
      await flow.shot("link-continue-in-browser");
      const link = await until(() => accountLinkFrom(flow.opened(since)), { timeout: 30_000, what: "the browser sign-in for linking" });
      const web = await webAccountStep(link, { email, log: flow.log, shot: (label) => join(out, `link-${label}.png`) });
      flow.facts.linkWeb = web.steps;
    } else flow.friction("confusing", "own server", "signed out, linking did not ask for the account in the browser");
    line = await flow.waitText(/\(?curl -fsSL https:\/\/link\.dusk\.bot\/i\/[a-z0-9-]+[^\n]*?\| sh( -s -- --[a-z]+)?/, "the install line", { timeout: 90_000 });
    return signIn ? "continued in the browser, then the line came by itself" : "the line";
  }, { critical: true });

  await flow.step("server", "a throwaway server runs the line, and the app links it", async () => {
    for (const old of await leftoverVms()) if (Date.parse(old.createdAt ?? 0) < Date.now() - 60 * 60_000) await removeVm(old.id).catch(() => {});
    vm = await createVm(`dusk-smoke-s2c-${stamp.slice(5).replace(/[^0-9]/g, "")}`);
    const made = vm; flow.atClose(async () => { await made.remove(); flow.log(`deleted ${made.id}`); });
    await vm.exec(`cd ~ && setsid nohup bash -c ${js(`${line}; echo "exit \\$?" >> ~/dusk-install.log`)} > ~/dusk-install.log 2>&1 < /dev/null & echo started`, 30);
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

  await flow.step("sign-out", "signs out of the account (a server linked, the app signed out: the owner's case)", async () => {
    await flow.evaluate(`window.duskDesktop.cloudAccount.signOut()`);
    await flow.waitFor(`window.duskDesktop.cloudAccount.state().then((s) => !s.account)`, "signed out", 30_000);
  }, { critical: true });

  await flow.step("server-page", "opens the server's own page", async () => {
    await flow.waitText(/is connected/i, "the connected screen", { timeout: 60_000 });
    await until(() => flow.evaluate(`(() => { const b = [...document.querySelectorAll("[role=dialog] button, button")].filter((e) => e.getClientRects().length).find((e) => /^open \\S/i.test(e.innerText.trim())); if (!b) return false; b.click(); return true; })()`), { what: "open <server>" });
    const url = await until(async () => { const page = (await flow.app.targets()).find((t) => t.type === "page" && t.url.startsWith("https:") && !/\/rail/.test(t.url)); return page?.url; }, { timeout: 60_000, what: "the server's page" });
    serverOrigin = new URL(url).origin;
    await flow.app.reattach(serverOrigin);
    await flow.waitFor(`Boolean(window.duskDesktop?.vpsCloudMove)`, "the server page's move bridge", 60_000);
    return serverOrigin;
  }, { critical: true });

  let since = 0, web = null;
  await flow.step("get-cloud", "Get dusk cloud while signed out continues in the browser (no 'sign in on this Mac's page first')", async () => {
    since = Date.now();
    let answer;
    try { answer = await act(`window.duskDesktop.vpsCloudMove.buy("plus")`); }
    catch (error) { throw new Error(`the buy refused: ${error.message}`); }
    flow.facts.afterBuy = answer;
    if (answer?.signingIn !== true) throw new Error(`the move did not wait in the browser: ${JSON.stringify(answer).slice(0, 160)}`);
    await sleep(1500);
    if (/own page|first, then come back/i.test(await flow.text())) throw new Error("the old 'sign in elsewhere first' error is back");
    return "continue in your browser";
  }, { critical: true });

  await flow.step("browser", "in the browser: sign up, approve, the plan's checkout, paid in test mode, you're all set", async () => {
    const link = await until(() => accountLinkFrom(flow.opened(since)), { timeout: 30_000, what: "the browser sign-in the app opened" });
    flow.facts.opened = link.replace(/code=[^&]+/, "code=<code>");
    web = await webAccountStep(link, { email, pay: !flag("--no-pay"), log: flow.log, shot: (label) => join(out, `${label}.png`) });
    if (!flag("--no-pay") && !web.allSet) flow.friction("confusing", "after paying", "the website did not show \"you're all set\" with the way back to the app");
    return web.steps.join("; ");
  }, { critical: true });

  await flow.step("app-signed-in", "the app signed itself in, without coming back to it", async () => {
    const view = await until(async () => { const v = await flow.evaluate(`window.duskDesktop.vpsCloudMove.view()`); return v && !v.signingIn ? v : false; }, { timeout: 60_000, what: "the app to pick up the sign-in" });
    return `move: ${view.stage}`;
  });

  if (flag("--no-pay")) return;
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
