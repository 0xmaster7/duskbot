import { afterEach, expect, test, vi } from "vitest";
import type { CommandView, WorkspaceDetail, WorkspaceSummary } from "../../../../shared/dashboard-protocol";
import { ANSWER_MS, PICKUP_MS, flowKey, followCommand, resetAppFlows, runAppFlow, type FlowDeps, type SignInTab } from "./app-connect";
import type { CloudDesktop } from "./contracts";

vi.mock("../lib/api", () => ({ api: {} }));
afterEach(() => resetAppFlows());

const cloudWs: WorkspaceSummary = { id: "ws", name: "My Cloud", kind: "vps", version: "1", connectedAt: 0, lastReportAt: 1, freshness: "live" };
const mac: WorkspaceSummary = { ...cloudWs, name: "studio", kind: "mac" };

/** a workspace on a virtual clock: `take` and `answer` say when (in ms after the command) it takes and answers it */
function world(script: { take?: number; answer?: number; result?: Partial<CommandView>; reportsAfterWake?: number } = {}) {
  let time = 0, queuedAt = -1, powered = -1, lastReportAt = 1;
  const command: CommandView = { id: "cmd", kind: "app.connect", target: "gmail", issuedAt: 0, expiresAt: 600_000, status: "queued", message: null, doneAt: null };
  const said: string[] = [];
  const tab: SignInTab & { url: string | null; closed: boolean } = { url: null, closed: false, say: (text) => said.push(text), go(url) { this.url = url; }, close() { this.closed = true; } };
  const deps: FlowDeps = {
    now: () => time,
    sleep: async (ms) => { time += ms; },
    power: async () => { powered = time; },
    command: async () => { queuedAt = time; return { command: { ...command } }; },
    connections: async () => ({ byWorkspace: { ws: time - queuedAt > 40_000 ? ["gmail"] : [] }, pending: {}, available: {}, at: {} }),
    workspace: async () => {
      if (powered >= 0 && script.reportsAfterWake !== undefined && time - powered >= script.reportsAfterWake) lastReportAt = time;
      const since = queuedAt < 0 ? -1 : time - queuedAt;
      const view = { ...command };
      if (since >= 0 && script.take !== undefined && since >= script.take) view.status = "sent";
      if (since >= 0 && script.answer !== undefined && since >= script.answer) Object.assign(view, { status: "done", url: "https://connect.composio.dev/link/x" }, script.result);
      return { workspace: { ...cloudWs, lastReportAt, freshness: "live" }, report: null, sectionAt: {}, history: [], commands: queuedAt < 0 ? [] : [view] } as WorkspaceDetail;
    },
  };
  return { deps, tab, said, time: () => time };
}

test("a link comes back in seconds and the tab goes to it", async () => {
  const w = world({ take: 700, answer: 2100 });
  await runAppFlow("connect", cloudWs, "gmail", "Gmail", undefined, w.deps, w.tab);
  expect(w.tab.url).toBe("https://connect.composio.dev/link/x");
  expect(w.said).toEqual(["asking My Cloud for the Gmail sign-in.", "getting the Gmail sign-in from My Cloud."]);
});

test("a workspace that never takes the command ends in PICKUP_MS with what to do next, in the tab too", async () => {
  const cloud = world();
  expect(await followCommand(cloudWs, "app.connect", "gmail", cloud.deps)).toEqual({ ok: false, message: "My Cloud is not answering right now. try again in a minute." });
  expect(cloud.time()).toBeLessThanOrEqual(PICKUP_MS + 1000);
  const quiet = world();
  await runAppFlow("connect", mac, "gmail", "Gmail", undefined, quiet.deps, quiet.tab);
  expect(quiet.said.at(-1)).toBe("studio is not answering. open dusk bot on it, then try again.\n\nyou can close this tab.");
  expect(quiet.tab.url).toBeNull();
});

test("taken but never answered ends in ANSWER_MS; a failure the workspace sends is shown as it is", async () => {
  const stuck = world({ take: 700 });
  expect(await followCommand(cloudWs, "app.connect", "gmail", stuck.deps)).toMatchObject({ ok: false, message: "My Cloud did not hand back a sign-in page. try again." });
  expect(stuck.time()).toBeLessThanOrEqual(ANSWER_MS + 1000);
  const refused = world({ take: 700, answer: 1400, result: { status: "failed", message: "Apps are not set up on this workspace." } });
  expect(await followCommand(cloudWs, "app.connect", "gmail", refused.deps)).toEqual({ ok: false, message: "Apps are not set up on this workspace." });
});

test("a sleeping cloud wakes first, saying so in the tab, then the sign-in loads", async () => {
  const w = world({ reportsAfterWake: 9_000, take: 700, answer: 3000 });
  await runAppFlow("connect", cloudWs, "gmail", "Gmail", { id: "c" } as CloudDesktop, w.deps, w.tab);
  expect(w.said[0]).toBe("waking My Cloud. this takes about half a minute.");
  expect(w.tab.url).toBe("https://connect.composio.dev/link/x");
});

test("a cloud that does not wake says so instead of waiting on", async () => {
  const w = world();
  await runAppFlow("connect", cloudWs, "gmail", "Gmail", { id: "c" } as CloudDesktop, w.deps, w.tab);
  expect(w.said.at(-1)).toBe("My Cloud did not wake up. try again in a minute.\n\nyou can close this tab.");
});

test("a second click while one runs opens nothing new", async () => {
  const w = world({ take: 700, answer: 2100 }), second = { ...w.tab, closed: false, close() { this.closed = true; } };
  const first = runAppFlow("connect", cloudWs, "gmail", "Gmail", undefined, w.deps, w.tab);
  await runAppFlow("connect", cloudWs, "gmail", "Gmail", undefined, w.deps, second);
  expect(second.closed).toBe(true);
  await first;
  expect(flowKey("ws", "gmail")).toBe("ws:gmail");
});
