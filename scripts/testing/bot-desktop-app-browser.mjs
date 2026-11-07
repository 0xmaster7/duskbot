import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createBrowserHost } from "../../server/host/browser.ts";
import { listsComputerTool } from "../../server/computer-tool-list.ts";
import { TurnResources } from "../../server/turn-resources.ts";

const [endpoint, evidence, driverToolsJson, flowJson] = process.argv.slice(2);
const flow = JSON.parse(flowJson || "{}");
const fileTag = flow.tag || "";
assert.match(fileTag, /^[a-z0-9-]{0,32}$/);
const inputText = flow.inputText || "AppBridgeInput";
assert.match(endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
const bot = { id: flow.botId || "desktop-fixture", name: "Desktop fixture", threadId: flow.botId ? `${flow.botId}-thread` : "fixture-thread", browser: true, computer: "cloud", cloudBackend: "vps" };
const turn = { threadId: bot.threadId, generation: "fixture-generation" };
const resources = new TurnResources();
const minted = [];
const host = createBrowserHost({
  cfg: { features: { browser: true }, browserEngine: { engine: "agent-browser" } },
  store: () => ({ bots: [bot], bot: id => id === bot.id ? bot : undefined, botByThread: id => id === bot.threadId ? bot : undefined }),
  turnResources: resources,
  activeInternalGenerationByThread: new Map([[turn.threadId, turn.generation]]),
  mintInternalCapability: capability => { minted.push({ botId: capability.botId, threadId: capability.threadId }); return "fixture-capability"; },
  DESKTOP_MANAGED: false,
  CLOUD_HOME: null,
  PORT: 1,
  boxChrome: async (botId, owner) => {
    assert.equal(botId, bot.id);
    assert.ok(owner && resources.claim("computer:fixture", owner));
    return endpoint;
  },
});
const result = { endpoint, calls: [] };
let browser;
try {
  browser = await host.browserIntegration(bot.id, undefined, turn);
  assert.ok(browser);
  assert.equal(browser.spec.env.AGENT_BROWSER_CDP, endpoint);
  assert.equal(browser.spec.env.AGENT_BROWSER_AUTO_CONNECT, undefined);
  assert.equal(browser.spec.env.AGENT_BROWSER_RESTORE_SAVE, "never");
  const driverTools = JSON.parse(driverToolsJson);
  const filtered = driverTools.filter(name => listsComputerTool(name, Boolean(browser.integration)));
  for (const name of ["browser_prepare", "browser_navigate", "browser_click", "browser_type", "get_browser_state"]) {
    assert.ok(driverTools.includes(name));
    assert.equal(filtered.includes(name), false);
  }
  for (const name of ["click", "type_text", "get_desktop_state"]) assert.ok(filtered.includes(name));
  result.hiddenCuaBrowserTools = driverTools.filter(name => !filtered.includes(name) && (name.startsWith("browser_") || name === "get_browser_state"));
  const listed = await host.browserRuntime.agentRpc(browser.session, browser.spec, "tools/list", {});
  const names = listed.tools.map(tool => tool.name);
  result.toolNames = names;
  for (const name of ["agent_browser_open", "agent_browser_fill", "agent_browser_click", "agent_browser_read"]) assert.ok(names.includes(name));
  const call = async (name, args) => {
    const at = performance.now();
    console.log(JSON.stringify({ phase: "start", name, args, at: Date.now() }));
    const response = await host.browserRuntime.agentRpc(browser.session, browser.spec, "tools/call", { name, arguments: args });
    result.calls.push({ name, elapsed: Math.round(performance.now() - at) });
    console.log(JSON.stringify({ phase: "done", ...result.calls.at(-1) }));
    assert.notEqual(response.isError, true, JSON.stringify(response.content));
    return response;
  };
  let text = null;
  if (!flow.skipForm) {
    await call("agent_browser_open", { url: "http://127.0.0.1:8765/" });
    await call("agent_browser_fill", { selector: "input[name=name]", text: inputText });
    await call("agent_browser_click", { selector: "button" });
    const read = await call("agent_browser_read", { maxChars: 2000 });
    text = read.content.filter(part => part.type === "text").map(part => part.text).join("\n");
    assert.ok(text.includes(`Saved ${inputText}`), text);
  }
  result.read = text;
  if (flow.cookieSet) await call("agent_browser_open", { url: `http://127.0.0.1:8765/cookie?value=${encodeURIComponent(flow.cookieSet)}` });
  if (flow.cookieExpected) {
    await call("agent_browser_open", { url: `http://127.0.0.1:8765/observe?screen=${flow.display}` });
    const observed = await call("agent_browser_read", { maxChars: 2000 });
    const cookie = observed.content.filter(part => part.type === "text").map(part => part.text).join("\n");
    assert.ok(cookie.includes(`FixtureScreen=${flow.cookieExpected}`), cookie);
    result.cookie = flow.cookieExpected;
  }
  if (flow.sharedText) {
    await call("agent_browser_open", { url: "http://127.0.0.1:8765/shared" });
    const shared = await call("agent_browser_read", { maxChars: 2000 });
    const sharedText = shared.content.filter(part => part.type === "text").map(part => part.text).join("\n");
    assert.ok(sharedText.includes(flow.sharedText), sharedText);
    result.sharedText = flow.sharedText;
  }
  if (flow.leaveForm) await call("agent_browser_open", { url: "http://127.0.0.1:8765/" });
  result.capabilityOwners = minted;
  result.lease = resources.holder("computer:fixture");
  result.ok = true;
} finally {
  if (browser) result.closed = await host.closeBrowser(browser.session, browser.spec);
  await host.browserRuntime.closeAll();
  resources.release(turn);
  await writeFile(join(evidence, fileTag ? `app-browser-${fileTag}.json` : "app-browser.json"), JSON.stringify(result, null, 2));
}
