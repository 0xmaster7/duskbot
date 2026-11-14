// Onboarding as a brand-new person: a fresh profile and a fresh dusk bot account on preview, the app's account gate,
// then the welcome funnel down one path: this Mac (the free model, bringing notes from another AI, the first bot), dusk
// cloud (the buying sheet opens over the funnel) or your own server (the install line). Nothing is bought or installed
// here: buy-cloud.mjs and add-server.mjs do those for real.
//
//   node scripts/smoke/flows/onboarding.mjs [--path mac|cloud|server] [--out DIR] [--profile DIR] [--email ADDRESS]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFlow, flowArgs, runFlow, sleep } from "./lib.mjs";

const { option, root, out, profile, email } = flowArgs("onb");
const path = option("--path", "mac");
if (!["mac", "cloud", "server"].includes(path)) throw new Error("--path is mac, cloud or server");
const flow = createFlow({ name: `onboarding-${path}`, title: `onboarding (${path === "mac" ? "this Mac" : path === "cloud" ? "dusk cloud" : "own server"})`, root, out, profile, email });

/** the notes another AI writes when the funnel's prompt is pasted there, as dusk-bot-notes.json in Downloads */
const NOTES = {
  format: "dusk-bot-notes", version: 2, from: "ChatGPT",
  about_me: { basics: ["Sam Rivera, lives in Lisbon, time zone Europe/Lisbon"], work: ["Runs a two-person bakery called Forno"], projects: ["A second shop in Porto, March 2027"],
    goals: ["Wholesale to 40 cafes"], people: ["Ana, business partner"], preferences: ["Short answers"], writing_style: ["Plain and friendly"], tools: ["Gmail", "Google Sheets"], schedule: ["Starts at 5am"] },
  instructions: "Keep it short. Use euros.", memories: ["Sam sends invoices on Fridays"], open_threads: ["Pick a Porto landlord"], recurring_tasks: [], connected_apps: ["Gmail"],
  bots: [{ name: "Ledger", description: "Tracks wholesale invoices", instructions: "You track Forno's wholesale invoices. Remind Sam on Fridays to send them.", knowledge_files: [], memories: ["40 cafe goal"], skills: [], routines: [], apps: [] }],
};

const funnelText = () => flow.evaluate(`(() => { const all = [...document.querySelectorAll("h1,h2")].filter((h) => h.getClientRects().length).map((h) => h.innerText.trim()); return all.join(" / "); })()`);

await runFlow(flow, async () => {
  await flow.step("launch", "a fresh app starts at the account gate", async () => {
    await flow.launch();
    await flow.waitText(/sign in to dusk bot/i, "the account gate", 120_000);
    const providers = await flow.evaluate(`[...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter((t) => /^continue with/i.test(t))`);
    flow.facts.gateProviders = providers;
    if (!providers.some((p) => /apple/i.test(p))) flow.friction("confusing", "account gate", `no Apple sign-in on a Mac (offered: ${providers.join(", ") || "email only"})`);
    return providers.join(", ");
  }, { critical: true });

  await flow.step("sign-in", "signs in with an emailed code", () => flow.signInAtGate(), { critical: true });

  await flow.step("welcome", "the welcome screen", async () => {
    await flow.waitText(/meet dusk bot|where should your bots live/i, "the welcome", 60_000);
    const behind = await flow.evaluate(`document.querySelectorAll('[data-chat-message], [data-message-id]').length`);
    if (behind) flow.friction("confusing", "welcome", "the chief's greeting is already playing in the chat behind the welcome before the person has picked anything");
    await flow.click("get started", { timeout: 10_000 }).catch(() => {});
    await flow.waitText(/where should your bots live/i, "where should your bots live");
    return await funnelText();
  }, { critical: true });

  if (path === "cloud") {
    await flow.step("pick-cloud", "dusk cloud opens the buying sheet over the funnel", async () => {
      await flow.click("dusk cloud", { contains: true });
      await sleep(2500);
      const shown = await flow.text("[role=dialog]");
      if (!/\$|plan|month/i.test(shown)) throw new Error(`no plans in the sheet: ${shown.slice(0, 200)}`);
      flow.facts.cloudSheet = shown.replace(/\s+/g, " ").slice(0, 400);
      return shown.replace(/\s+/g, " ").slice(0, 160);
    });
    return;
  }

  if (path === "server") {
    await flow.step("pick-server", "your own server shows the install line", async () => {
      await flow.click("use your own server", { contains: true });
      const line = await flow.waitText(/\(curl -fsSL https:\/\/link\.dusk\.bot\/i\/[a-z0-9-]+ \|\| echo '[^']*'\) \| sh/, "the install line", { timeout: 45_000 });
      flow.facts.installLine = line.replace(/\/i\/[a-z0-9-]+/, "/i/<code>");
      return "the one line is ready";
    });
    return;
  }

  await flow.step("pick-mac", "this Mac goes on to connect an AI", async () => {
    await flow.click("this Mac", { contains: true });
    // the owner's "this Mac" sheet offers dusk cloud once; the person keeps this Mac
    await flow.click("continue with this mac", { timeout: 8_000 }).catch(() => {});
    await flow.waitText(/connect an AI/i, "connect an AI");
  });

  await flow.step("ai-claude", "Claude's sign-in opens on claude.com", async () => {
    const since = Date.now();
    await flow.click("Claude");
    await sleep(3000);
    const opened = flow.opened(since);
    const claude = opened.find((url) => /^https:\/\/(claude\.com|claude\.ai|console\.anthropic\.com)\//.test(url));
    if (!claude) throw new Error(`nothing opened on claude.com (${opened.join(", ") || "nothing"})`);
    const paste = await flow.evaluate(`Boolean([...document.querySelectorAll("input,textarea")].find((e) => /code/i.test(e.placeholder || "")))`);
    if (paste && !/browser|opened/i.test(await flow.text())) flow.friction("confusing", "connect an AI", "after picking Claude only a 'paste the code' field appears; nothing says the browser opened or where the code comes from");
    return "the provider page opened; a real Claude sign-in needs a person and is not done here";
  });

  await flow.step("ai-free", "starts with the free model", async () => {
    await flow.click("start with the free model");
    await flow.waitText(/bring what you already use|bring your bots/i, "the import step", { timeout: 30_000 });
    return await funnelText();
  });

  await flow.step("import", "brings notes from another AI in by itself", async () => {
    const since = Date.now();
    await flow.click("copy the prompt");
    await sleep(800);
    // what the other AI does with the prompt: a file in Downloads
    mkdirSync(join(profile, "home", "Downloads"), { recursive: true });
    await sleep(1500);
    writeFileSync(join(profile, "home", "Downloads", "dusk-bot-notes.json"), JSON.stringify(NOTES, null, 2));
    flow.facts.notesWrittenAfterMs = Date.now() - since;
    await flow.click("continue");
    return "prompt copied, notes saved to Downloads";
  });

  await flow.step("phone", "the phone step (skipped) or straight on", async () => {
    await sleep(1500);
    if (/dusk bot on your phone/i.test(await flow.text())) {
      flow.friction("extra-click", "phone step", "a phone QR step in the first run before the person has used a bot");
      await flow.click("skip");
      return "skipped";
    }
    return "no phone step";
  });

  await flow.step("first-bot", "lands in the app with the imported bot", async () => {
    await flow.waitFor(`Boolean(document.querySelector('textarea[aria-label^="Message"]'))`, "the chat", 60_000);
    const started = Date.now();
    // the dev app's server is not the desktop's own child, so it refuses to read Downloads (a packaged build does);
    // there the person pastes the other AI's answer into the chat instead, which is what happens here
    const look = await flow.evaluate(`fetch("/api/setup-import/notes?since=1").then((r) => r.status)`);
    if (look === 403) {
      flow.facts.notesVia = "paste (the dev app cannot read Downloads)";
      await sleep(6000);
      await flow.evaluate(`(() => { const box = document.querySelector('textarea[aria-label^="Message"]'); box.focus();
        const data = new DataTransfer(); data.setData("text/plain", ${JSON.stringify(JSON.stringify(NOTES, null, 2))});
        box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); return true; })()`);
    } else flow.facts.notesVia = "Downloads";
    const names = await flow.waitFor(`fetch("/api/bots").then((r) => r.json()).then((j) => { const names = (j.bots ?? j).map((b) => b.name); return names.includes("Ledger") ? names : false; })`, "the imported bot Ledger", 120_000)
      .catch(async () => {
        const look = await flow.evaluate(`fetch("/api/setup-import/notes?since=1").then(async (r) => r.status + " " + (await r.text()).slice(0, 160)).catch((e) => String(e))`);
        const line = await flow.evaluate(`document.querySelector("[data-notes-waiting]")?.innerText ?? document.body.innerText.match(/[^\\n]*notes[^\\n]*/i)?.[0] ?? ""`);
        throw new Error(`no imported bot after 2 minutes (bots: ${JSON.stringify(await flow.evaluate(`fetch("/api/bots").then((r) => r.json()).then((j) => (j.bots ?? j).map((b) => b.name))`))}; Downloads look: ${look}; on screen: ${line})`);
      });
    flow.facts.importSeconds = Math.round((Date.now() - started) / 1000);
    if (flow.facts.importSeconds > 20) flow.friction("slow", "import", `the notes took ${flow.facts.importSeconds}s to show up after the funnel ended`);
    await flow.click("Ledger", { contains: true, scope: "nav, aside, body" }).catch(() => {});
    await sleep(1500);
    return `bots: ${names.join(", ")}`;
  });

  await flow.step("account-menu", "the account menu knows who is signed in", async () => {
    const state = await flow.accountState();
    if (state?.status !== "connected") throw new Error(`the app's account is ${state?.status}`);
    flow.facts.account = { email: state.account?.email, plan: state.entitlement?.plan };
    return `${state.account.email}, ${state.entitlement?.plan ?? "no"} plan`;
  });
});
