import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { removeTempDir } from "./testing/cleanup.ts";
import { ComputerToolLists, createComputerRelay, relayedComputerSpec, vpsToolsKey, type RelayBridge } from "./vps-computer-relay.ts";

const home = mkdtempSync(join(tmpdir(), "omb-computer-relay-"));
const driver = join(home, "driver.mjs");
// a stdio mcp server standing in for the cua driver inside the desktop
writeFileSync(driver, `
import { appendFileSync } from "node:fs";
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let at = buffer.indexOf("\\n"); at !== -1; at = buffer.indexOf("\\n")) {
    const frame = JSON.parse(buffer.slice(0, at));
    buffer = buffer.slice(at + 1);
    if (frame.id === undefined) continue;
    const answer = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }) + "\\n");
    if (frame.method === "initialize") answer({ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake-cua", version: "1" } });
    else if (frame.method === "tools/list") answer({ tools: [{ name: "screenshot", inputSchema: { type: "object" } }, { name: "launch_app", inputSchema: { type: "object" } }] });
    else if (frame.method === "tools/call") {
      appendFileSync(process.env.DRIVER_LOG, JSON.stringify(frame.params) + "\\n");
      answer({ content: [{ type: "text", text: "did " + frame.params.name }] });
    }
  }
});
`);
afterAll(() => removeTempDir(home));

const bridgeFor = (log: string): RelayBridge => ({ command: process.execPath, args: [driver], env: { DRIVER_LOG: log } });
const owner = { threadId: "thread-1", generation: "gen-1" };
const KEY = vpsToolsKey({ desktop: "bot-desktop", driver_version: "1.0" });
const KNOWN = [{ name: "screenshot", inputSchema: { type: "object" } }];

function asleepTurn(log: string, options: { failures?: number; delayMs?: number } = {}) {
  let awake: RelayBridge | null = null;
  let failures = options.failures ?? 0;
  const wakes: number[] = [];
  return {
    wakes,
    turn: {
      bridge: () => awake,
      wake: async () => {
        wakes.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 20));
        if (failures-- > 0) throw new Error("docker start failed");
        return awake = bridgeFor(log);
      },
      toolsKey: KEY,
    },
  };
}

describe("the relayed VPS computer", () => {
  it("lists a sleeping computer's tools without waking it, and wakes it on the first call in the same turn", async () => {
    const lists = new ComputerToolLists();
    lists.set(KEY, KNOWN);
    const relay = createComputerRelay({ lists });
    const log = join(home, "first.log");
    writeFileSync(log, "");
    const { turn, wakes } = asleepTurn(log);
    relay.open(owner, turn);
    expect(relay.knowsTools(KEY)).toBe(true);
    expect(relay.asleep(owner)).toBe(true);

    expect(await relay.request(owner, { method: "tools/list", params: {} })).toEqual({ result: { tools: KNOWN } });
    expect(wakes).toHaveLength(0);

    const [first, second] = await Promise.all([
      relay.request(owner, { method: "tools/call", params: { name: "launch_app", arguments: { url: "https://siddz.com" } } }),
      relay.request(owner, { method: "tools/call", params: { name: "screenshot", arguments: {} } }),
    ]);
    expect(first).toEqual({ result: { content: [{ type: "text", text: "did launch_app" }] } });
    expect(second).toEqual({ result: { content: [{ type: "text", text: "did screenshot" }] } });
    expect(wakes).toHaveLength(1);
    expect(relay.asleep(owner)).toBe(false);
    expect(readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line).name).sort()).toEqual(["launch_app", "screenshot"]);

    // once awake, the list comes from the driver and is remembered for the next sleeping turn
    const live = await relay.request(owner, { method: "tools/list", params: {} });
    expect((live as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name)).toEqual(["screenshot", "launch_app"]);
    expect(lists.get(KEY)?.map((tool) => (tool as { name: string }).name)).toEqual(["screenshot", "launch_app"]);
    relay.close(owner);
  });

  it("wakes once for a shell command, then serves screen calls without waking again", async () => {
    const lists = new ComputerToolLists();
    lists.set(KEY, KNOWN);
    const relay = createComputerRelay({ lists });
    const log = join(home, "exec.log");
    writeFileSync(log, "");
    const { turn, wakes } = asleepTurn(log);
    relay.open(owner, turn);
    await relay.wake(owner);
    expect(relay.asleep(owner)).toBe(false);
    expect(await relay.request(owner, { method: "tools/call", params: { name: "screenshot", arguments: {} } }))
      .toEqual({ result: { content: [{ type: "text", text: "did screenshot" }] } });
    expect(wakes).toHaveLength(1);
    relay.close(owner);
  });

  it("reports a failed wake to the call and tries again on the next one", async () => {
    const lists = new ComputerToolLists();
    const relay = createComputerRelay({ lists });
    const log = join(home, "retry.log");
    writeFileSync(log, "");
    const { turn, wakes } = asleepTurn(log, { failures: 1 });
    relay.open(owner, turn);
    expect(await relay.request(owner, { method: "tools/call", params: { name: "screenshot", arguments: {} } }))
      .toEqual({ error: "The cloud computer could not be started: docker start failed" });
    expect(await relay.request(owner, { method: "tools/call", params: { name: "screenshot", arguments: {} } }))
      .toEqual({ result: { content: [{ type: "text", text: "did screenshot" }] } });
    expect(wakes).toHaveLength(2);
    relay.close(owner);
  });

  it("answers a call whose wake outlasts the budget with a retry line, and nothing ran", async () => {
    const relay = createComputerRelay({ lists: new ComputerToolLists(), budgetMs: 50 });
    const log = join(home, "slow.log");
    writeFileSync(log, "");
    const { turn } = asleepTurn(log, { delayMs: 300 });
    relay.open(owner, turn);
    expect(await relay.request(owner, { method: "tools/call", params: { name: "screenshot", arguments: {} } }))
      .toEqual({ error: "The cloud computer is still starting. Call the tool again in a moment; nothing ran yet." });
    expect(readFileSync(log, "utf8")).toBe("");
    relay.close(owner);
  });

  it("serves only the turn that mounted it, and nothing after the turn ends", async () => {
    const lists = new ComputerToolLists();
    lists.set(KEY, KNOWN);
    const relay = createComputerRelay({ lists });
    const log = join(home, "ended.log");
    writeFileSync(log, "");
    relay.open(owner, asleepTurn(log).turn);
    expect(await relay.request({ ...owner, generation: "gen-0" }, { method: "tools/list" })).toEqual({ error: "This turn has no cloud computer." });
    expect(await relay.request(owner, { method: "resources/list" })).toEqual({ error: "Unsupported computer method." });
    relay.close(owner);
    expect(await relay.request(owner, { method: "tools/call", params: { name: "screenshot", arguments: {} } })).toEqual({ error: "This turn has no cloud computer." });
    await expect(relay.wake(owner)).rejects.toThrow("This turn has no cloud computer.");
    expect(readFileSync(log, "utf8")).toBe("");
  });

  it("keeps known tool lists on disk across restarts", () => {
    const file = join(home, "lists.json");
    new ComputerToolLists(file).set(KEY, KNOWN);
    expect(new ComputerToolLists(file).get(KEY)).toEqual(KNOWN);
    expect(new ComputerToolLists(join(home, "missing.json")).get(KEY)).toBeNull();
  });

  it("mounts the harness proxy, holding only the turn's capability", () => {
    const spec = relayedComputerSpec("cap-token", 8799);
    expect(spec.args.at(-1)).toBe("computer");
    expect(spec.env).toMatchObject({ OMB_MCP_TOKEN_COMPUTER: "cap-token", OMB_HARNESS_URL: "http://127.0.0.1:8799" });
    expect(Object.keys(spec.env)).not.toContain("OMB_CONTROL_TOKEN");
  });
});
