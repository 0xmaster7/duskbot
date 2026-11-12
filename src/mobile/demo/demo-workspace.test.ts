import { afterEach, describe, expect, it, vi } from "vitest";
import { createSseParser } from "../transport/transport";
import { createDemoWorkspace } from "./demo-workspace";
import { demoOn, enterDemo, leaveDemo } from "./demo-mode";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function frames(response: Response, count: number) {
  const reader = response.body!.getReader();
  const seen: Array<Record<string, any>> = [];
  const parser = createSseParser((event) => seen.push(JSON.parse(event.data)));
  while (seen.length < count) {
    const chunk = await reader.read();
    if (chunk.done) break;
    parser.push(chunk.value);
  }
  await reader.cancel();
  return seen;
}

describe("demo workspace", () => {
  it("answers the app's first reads with a team, a room and the real answers' fields, and never touches the network", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const demo = createDemoWorkspace();
    const snapshot = await (await demo.fetch("/api/bots?messages=50&selected=")).json();
    expect(snapshot.bots.map((bot: { name: string }) => bot.name)).toEqual(["Nova", "Rivet", "Quill", "Tally", "Echo", "Juno"]);
    expect(snapshot.bots[0]).toMatchObject({ pinned: true, unread: true, busy: false, modelSelection: { instanceId: "claude" }, approvalMode: "full" });
    expect(snapshot.bots[0].messages.map((message: { role: string }) => message.role)).toEqual(["user", "bot"]);
    expect(snapshot.groups[0]).toMatchObject({ name: "Launch room", defaultResponder: { kind: "everyone" } });
    expect(snapshot.groups[0].memberIds).toHaveLength(3);
    expect(snapshot.groups[0].messages[1].from).toMatchObject({ name: "Quill", botId: snapshot.groups[0].memberIds[1] });
    for (const path of ["/api/config", "/api/instances", "/api/notifications", "/api/routines", "/api/webhooks", "/api/auth/session"]) {
      expect((await demo.fetch(path)).status, path).toBe(200);
    }
    expect((await (await demo.fetch("/api/auth/session")).json()).kind).toBe("session");
    expect(network).not.toHaveBeenCalled();
    demo.close();
  });

  it("a message is echoed at once, the bot works, then replies and says it is a demo", async () => {
    const demo = createDemoWorkspace({ replyDelayMs: 5 });
    const { bots } = await (await demo.fetch("/api/bots")).json();
    const stream = await demo.fetch("/api/events");
    const sent = await demo.fetch(`/api/bots/${bots[1].id}/messages`, { method: "POST", body: JSON.stringify({ text: "Ship it", sendId: "send-1" }) });
    expect(sent.status).toBe(202);
    const seen = await frames(stream, 6);
    expect(seen.map((frame) => frame.kind)).toEqual(["hello", "message", "bot", "message", "bot", "message.patch"]);
    expect(seen[0]).toMatchObject({ kind: "hello", resumed: false });
    expect(seen[1]!.message).toMatchObject({ role: "user", text: "Ship it", sendId: "send-1" });
    expect(seen[2]!.bot).toMatchObject({ id: bots[1].id, busy: true });
    expect(seen[3]!.message).toMatchObject({ role: "bot", requestMessageId: seen[1]!.message.id });
    expect(seen[3]!.message.text).toMatch(/demo/i);
    expect(seen[4]!.bot.busy).toBe(false);
    expect(seen[5]!.message).toMatchObject({ id: seen[1]!.message.id, requestPending: false });
    demo.close();
  });

  it("a send that arrives twice is one message", async () => {
    const demo = createDemoWorkspace({ replyDelayMs: 60_000 });
    const { bots } = await (await demo.fetch("/api/bots")).json();
    const post = () => demo.fetch(`/api/bots/${bots[0].id}/messages`, { method: "POST", body: JSON.stringify({ text: "Once", sendId: "same" }) });
    const first = await (await post()).json(), again = await (await post()).json();
    expect(again.message.id).toBe(first.message.id);
    const after = await (await demo.fetch("/api/bots")).json();
    expect(after.bots[0].messages.filter((message: { text: string }) => message.text === "Once")).toHaveLength(1);
    demo.close();
  });

  it("reads, pins, creates and deletes, and refuses what it cannot pretend", async () => {
    const demo = createDemoWorkspace({ readOnly: "Not in the demo" });
    const { bots } = await (await demo.fetch("/api/bots")).json();
    await demo.fetch(`/api/bots/${bots[0].id}/read`, { method: "POST", body: "{}" });
    await demo.fetch(`/api/bots/${bots[2].id}`, { method: "PATCH", body: JSON.stringify({ pinned: true }) });
    const created = await (await demo.fetch("/api/bots", { method: "POST", body: JSON.stringify({ name: "Pip", color: "green" }) })).json();
    await demo.fetch(`/api/bots/${bots[5].id}`, { method: "DELETE" });
    const after = await (await demo.fetch("/api/bots")).json();
    expect(after.bots[0].unread).toBe(false);
    expect(after.bots[2].pinned).toBe(true);
    expect(after.bots.map((bot: { name: string }) => bot.name)).toEqual(["Nova", "Rivet", "Quill", "Tally", "Echo", "Pip"]);
    expect(created.bot).toMatchObject({ name: "Pip", color: "green", messages: [] });
    const refused = await demo.fetch("/api/routines", { method: "POST", body: "{}" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: "Not in the demo" });
    expect((await demo.fetch("/api/secrets")).status).toBe(404);
    demo.close();
  });
});

describe("demo workspace screens", () => {
  it("search finds words in any chat, newest first", async () => {
    const demo = createDemoWorkspace();
    const { hits } = await (await demo.fetch("/api/search?q=friday&limit=40")).json();
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits[0]).toMatchObject({ name: "Launch room", role: "bot", kind: "text", onActivePath: true });
    expect(hits[0].snippet.slice(hits[0].matchStart, hits[0].matchStart + hits[0].matchLength).toLowerCase()).toBe("friday");
    expect(hits.every((hit: { at: number }, index: number) => index === 0 || hits[index - 1].at >= hit.at)).toBe(true);
    expect((await (await demo.fetch("/api/search?q=")).json()).hits).toEqual([]);
    demo.close();
  });

  it("a new bot is made the way the app asks: defaults, create, then its look", async () => {
    const demo = createDemoWorkspace();
    const defaults = await (await demo.fetch("/api/bot-defaults")).json();
    expect(defaults).toMatchObject({ defaults: { skills: [], routines: [] }, modelSelection: { instanceId: "claude" } });
    const { bot } = await (await demo.fetch("/api/bots", { method: "POST", body: JSON.stringify({ name: "Pip", greeting: false, useDefaults: false }) })).json();
    const patched = await (await demo.fetch(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ name: "Pip", color: "green", mascotBody: "cloud" }) })).json();
    expect(patched.bot).toMatchObject({ id: bot.id, name: "Pip", color: "green", mascotBody: "cloud" });
    demo.close();
  });
});

describe("demo mode", () => {
  it("is remembered until it is left, and each change restarts the app", async () => {
    const values = new Map<string, string>();
    const platform = { prefs: { get: async (key: string) => values.get(key) ?? null, set: async (key: string, value: string) => { values.set(key, value); }, remove: async (key: string) => { values.delete(key); } } };
    const reload = vi.fn();
    expect(await demoOn(platform)).toBe(false);
    await enterDemo(platform, reload);
    expect(await demoOn(platform)).toBe(true);
    values.set("dusk.mobile.outbox.demo", "[]");
    await leaveDemo(platform, reload);
    expect(await demoOn(platform)).toBe(false);
    expect(values.size).toBe(0);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
