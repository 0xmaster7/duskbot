// The live part of scripts/bench-switching.ts: chats change while another is open (a long streamed reply after tool
// steps, in two chats, and in a bot's main thread while another of its threads is current), then each is opened and
// every change to its rows after the first paint is counted. Also after the live stream drops while those chats change,
// and after the server restarts while it is down.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "./bench-desktop-page.ts";

interface Chat { id: string; threadId: string; name: string; lastId: string }
type Switch = (botId: string, lastId: string, name: string, timeoutMs: number) => string;

/** What the fixture engine does each turn: a tool step with long output and a short one, then a long reply streamed in. */
export function liveEngineEnvironment(dir: string): Record<string, string> {
  const tools = join(dir, "bench-live-tools.json"), reply = join(dir, "bench-live-reply.txt");
  writeFileSync(tools, JSON.stringify([
    { name: "Bash", input: { command: "ls -la /var/log" }, output: Array.from({ length: 80 }, (_, i) => `-rw-r--r-- 1 root root ${1000 + i} log-${i}.txt`).join("\n") },
    { name: "Read", input: { file_path: "/etc/hosts" }, output: "127.0.0.1 localhost" },
  ]));
  writeFileSync(reply, Array.from({ length: 14 }, (_, i) => `Line ${i + 1}: the sync of account ${i * 7} finished, three records were checked and one was updated.`).join("\n\n"));
  return { FAKE_CLAUDE_TOOL_CALLS_FILE: tools, FAKE_CLAUDE_REPLY_FILE: reply, FAKE_CLAUDE_STREAM_CADENCE: "24:15" };
}

/** Records every live stream the page opens, so the bench can drop it as a tunnel would. */
export const STREAM_HANDLE = `(() => {
  const Native = window.EventSource;
  window.__benchStreams = [];
  window.EventSource = function (url, options) { const source = new Native(url, options); window.__benchStreams.push(source); return source; };
  window.EventSource.prototype = Native.prototype;
})();`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function livePasses(page: Page, url: string, chats: Chat[], SWITCH: Switch, restart: () => Promise<void>): Promise<Record<string, unknown>> {
  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${url}${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return response.json() as Promise<T>;
  };
  type WireBot = { id: string; name: string; threadId: string; mainThreadId?: string; busy?: boolean; tasks?: Array<{ threadId: string; busy?: boolean }> };
  const bots = async () => (await call<{ bots: WireBot[] }>("/api/bots?messages=0")).bots;
  const send = (chat: Chat, threadId: string, text: string) => call(`/api/bots/${chat.id}/messages`, { threadId, text });
  const settled = async (count: number) => {
    // every turn sent has its reply, and nothing is still working
    for (const deadline = Date.now() + 90_000; Date.now() < deadline; await sleep(250)) {
      const now = await bots();
      if (now.every((bot) => !bot.busy && !bot.tasks?.some((task) => task.busy)) && (await replies()) >= count) break;
    }
    await sleep(1_500);
  };
  let sent = 0;
  const replies = async () => {
    let total = 0;
    for (const chat of chats) {
      const owner = (await bots()).find((bot) => bot.id === chat.id)!;
      for (const threadId of new Set([owner.threadId, owner.mainThreadId ?? owner.threadId])) {
        const page = await call<{ messages: Array<{ role: string; kind: string; text?: string }> }>(`/api/threads/${threadId}/messages?limit=200`);
        total += page.messages.filter((message) => message.role === "bot" && message.kind === "text" && message.text?.startsWith("Line 1:")).length;
      }
    }
    return total;
  };
  const newest = async (threadId: string) => (await call<{ messages: Array<{ id: string }> }>(`/api/threads/${threadId}/messages?limit=1`)).messages.at(-1)!.id;
  const home = async () => {
    await page.evaluate(`[...document.querySelectorAll('[data-sidebar-bot-row]')].find((row) => row.textContent.includes("Quiet 1"))?.click()`);
    await sleep(800);
  };
  const open = async (chat: Chat, threadId: string) => {
    const sample = await page.evaluate<Record<string, unknown>>(SWITCH(chat.id, await newest(threadId), chat.name, 15_000));
    await home();
    return { chat: chat.name, ...sample };
  };
  const summary = (switches: Array<Record<string, unknown>>) => ({
    viewportChanges: switches.reduce((sum, entry) => sum + Number(entry.viewportChanges || 0), 0),
    contentChanges: switches.reduce((sum, entry) => sum + Number(entry.contentChanges || 0), 0),
    firstPaintWithoutNewest: switches.filter((entry) => entry.firstHadLast === false).length,
    reads: switches.reduce((sum, entry) => sum + (Array.isArray(entry.threadReadsMs) ? entry.threadReadsMs.length : 0), 0),
    switches,
  });
  const [b, c, d] = chats as [Chat, Chat, Chat];
  const passes: Record<string, unknown> = {};

  // two chats change while a third is open
  await home();
  await send(b, b.threadId, "Check the logs and tell me what changed");
  await send(c, c.threadId, "Check the logs and tell me what changed");
  sent += 2;
  await settled(sent);
  passes.background = summary([await open(b, b.threadId), await open(c, c.threadId)]);

  // a bot's main thread changes while another of its threads is current
  await call(`/api/bots/${d.id}/tasks`, {});
  const main = (await bots()).find((bot) => bot.id === d.id)!;
  await send(d, main.mainThreadId ?? d.threadId, "Check the logs and tell me what changed");
  sent += 1;
  await settled(sent);
  passes.otherThread = summary([await open(d, main.mainThreadId ?? d.threadId)]);

  // the live stream drops (a tunnel reconnecting) while two chats change
  const cut = async () => {
    await page.send("Network.setBlockedURLs", { urls: ["*/api/events*"] });
    await page.evaluate(`window.__benchStreams.forEach((source) => { source.close(); source.onerror?.(new Event("error")); })`);
  };
  const mend = async (opens: number) => {
    await page.send("Network.setBlockedURLs", { urls: [] });
    if (!await page.waitFor(`window.__benchStreams.length > ${opens} && window.__benchStreams.at(-1).readyState === 1`, 30_000)) throw new Error("the live stream did not come back");
    await sleep(2_500);
  };
  let opens = await page.evaluate<number>(`window.__benchStreams.length`);
  await cut();
  await send(b, b.threadId, "Check the logs again");
  await send(c, c.threadId, "Check the logs again");
  sent += 2;
  await settled(sent);
  await mend(opens);
  passes.reconnect = summary([await open(b, b.threadId), await open(c, c.threadId)]);

  // the server restarts while the stream is down, so nothing can be replayed
  opens = await page.evaluate<number>(`window.__benchStreams.length`);
  await cut();
  await restart();
  await send(b, b.threadId, "One more check");
  await send(c, c.threadId, "One more check");
  sent += 2;
  await settled(sent);
  await mend(opens);
  passes.restart = summary([await open(b, b.threadId), await open(c, c.threadId)]);
  return passes;
}
