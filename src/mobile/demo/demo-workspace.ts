import shapes from "./demo-shapes.json";

// A workspace that lives in the page: the same routes and live frames a real one answers with (their shapes are taken
// from a real server's answers, demo-shapes.json), a small invented team, and replies that say they are pretend. It lets
// someone see the app before they own a computer running Dusk Bot, and lets a store reviewer use every screen.

type Json = Record<string, unknown>;
type Message = { id: string; at: number; parentId: string | null; role: "user" | "bot"; kind: "text"; text: string; sendId?: string; requestMessageId?: string; requestPending?: boolean; from?: { botId: string; name: string; color: string } };
type Task = Json & { threadId: string; title: string; createdAt: number; updatedAt: number; unread: boolean };
type DemoBot = Json & { id: string; threadId: string; name: string; color: string; unread: boolean; busy: boolean; activity: string; pinned?: boolean; messages: Message[]; tasks: Task[] };
type DemoGroup = Json & { id: string; threadId: string; name: string; memberIds: string[]; unread: boolean; messages: Message[]; tasks: Task[] };

const MINUTE = 60_000;
const TEAM: Array<{ name: string; color: string; pinned?: boolean; ago: number; unread?: boolean; chat: Array<[role: "user" | "bot", text: string]> }> = [
  { name: "Nova", color: "pink", pinned: true, ago: 4, unread: true, chat: [
    ["user", "What needs my attention today?"],
    ["bot", "Morning! Three things need you today: the **launch note** draft, two invoices to approve, and a reply to Priya about Thursday."],
  ] },
  { name: "Rivet", color: "teal", pinned: true, ago: 26, chat: [
    ["user", "Check the build logs and tell me what broke"],
    ["bot", "Build is green again. The flaky test was a race in the upload retry; I pinned the timer and added a regression test."],
  ] },
  { name: "Quill", color: "orange", ago: 58, chat: [
    ["user", "Draft a short note to the team about Friday's launch"],
    ["bot", "Drafted the launch note. It leads with the new phone app and keeps it under 150 words. Want me to send it to the team channel?"],
  ] },
  { name: "Tally", color: "brown", ago: 3 * 60, chat: [
    ["user", "Summarise this month's spend"],
    ["bot", "This month's spend is up 6% on last month. Most of it is the design tools renewal; nothing looks off."],
  ] },
  { name: "Echo", color: "purple", ago: 7 * 60, chat: [
    ["user", "Clean up my inbox"],
    ["bot", "Inbox is down to 4. I archived the newsletters and flagged one from the bank that looks like it needs you."],
  ] },
  { name: "Juno", color: "red", ago: 26 * 60, chat: [
    ["user", "Book the dentist for next week"],
    ["bot", "Booked the dentist for Tuesday at 9:30 and added it to your calendar with a 30 minute reminder."],
  ] },
];
const ROOM = { name: "Launch room", members: ["Nova", "Quill", "Rivet"], ago: 12, chat: [
  ["user", "Where are we for Friday?"],
  ["Quill", "The note is drafted and waiting on your yes."],
  ["Rivet", "Build is green, and the release branch is cut."],
  ["Nova", "Then Friday is on. Demo at 10, retro at 2."],
] as Array<[string, string]> };

/** what a bot says back here: in character for a line, then plain about being a demo */
const REPLIES = [
  "On it. This is the demo workspace, so I can only pretend: with Dusk Bot on your own computer I would start now and message you when it is done.",
  "Here is how that goes for real: I plan the steps, do the work on your computer, and send you the result. The demo has no computer behind it.",
  "Noted. Link your own computer from Settings and ask me again, and I will pick it up for real.",
];

export interface DemoWorkspace {
  fetch: typeof fetch;
  /** stops the timers of replies still on their way */
  close(): void;
}

export function createDemoWorkspace(options: { now?: () => number; replyDelayMs?: number; readOnly?: string } = {}): DemoWorkspace {
  const now = options.now ?? Date.now;
  const replyDelay = options.replyDelayMs ?? 1400;
  const readOnly = options.readOnly ?? "The demo workspace cannot do this.";
  let ids = 0;
  const id = (kind: string) => `demo-${kind}-${++ids}`;
  let seq = 0;
  const streams = new Set<(text: string) => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let replies = 0;

  const from = (bot: Pick<DemoBot, "id" | "name" | "color"> | undefined) => (bot ? { from: { botId: bot.id, name: bot.name, color: bot.color } } : {});
  const thread = (owner: string, chat: Array<[string, string]>, startedAt: number, speaker: (who: string) => DemoBot | undefined = () => undefined): Message[] => {
    const messages: Message[] = [];
    chat.forEach(([who, text], index) => {
      messages.push({ id: id(`${owner}-m`), at: startedAt + index * 20_000, parentId: messages.at(-1)?.id ?? null, role: who === "user" ? "user" : "bot", kind: "text", text, ...from(speaker(who)) });
    });
    return messages;
  };
  const task = (threadId: string, title: string, messages: Message[], unread: boolean): Task => ({
    ...(shapes.task as Json), threadId, title, createdAt: messages[0]?.at ?? now(), updatedAt: messages.at(-1)?.at ?? now(), unread,
  });
  const bots: DemoBot[] = TEAM.map((one) => {
    const botId = id("bot"), threadId = id("thread");
    const messages = thread(botId, one.chat, now() - one.ago * MINUTE);
    return {
      ...(shapes.bot as Json), id: botId, threadId, mainThreadId: threadId, activeLeafId: messages.at(-1)?.id ?? null, name: one.name, color: one.color,
      createdAt: now() - 40 * 24 * 60 * MINUTE, unread: Boolean(one.unread), busy: false, activity: "idle", ...(one.pinned ? { pinned: true } : {}),
      messages, tasks: [task(threadId, one.chat[0]![1], messages, Boolean(one.unread))],
    };
  });
  const byName = (name: string) => bots.find((bot) => bot.name === name);
  const groups: DemoGroup[] = [(() => {
    const groupId = id("room"), threadId = id("thread");
    const messages = thread(groupId, ROOM.chat, now() - ROOM.ago * MINUTE, (who) => byName(who));
    return {
      ...(shapes.group as Json), id: groupId, threadId, name: ROOM.name, memberIds: ROOM.members.map((name) => byName(name)!.id), unread: false,
      createdAt: now() - 9 * 24 * 60 * MINUTE, activeLeafId: messages.at(-1)?.id ?? null, messages, tasks: [task(threadId, ROOM.chat[0]![1], messages, false)],
    };
  })()];
  const notifications: Json[] = bots.filter((bot) => bot.unread).map((bot) => ({
    id: id("note"), at: bot.messages.at(-1)!.at, kind: "done", botId: bot.id, botName: bot.name, threadId: bot.threadId, title: `${bot.name} finished`, body: bot.messages.at(-1)!.text, read: false,
  }));

  const emit = (frame: Json) => {
    const text = `id: demo:${++seq}\ndata: ${JSON.stringify({ ...frame, seq })}\n\n`;
    for (const write of streams) write(text);
  };
  const withoutMessages = ({ messages: _messages, ...rest }: DemoBot | DemoGroup) => rest;
  const patchBot = (bot: DemoBot, patch: Json) => { Object.assign(bot, patch); emit({ kind: "bot", bot: withoutMessages(bot) }); };
  const later = (ms: number, work: () => void) => {
    const timer = setTimeout(() => { timers.delete(timer); work(); }, ms);
    timers.add(timer);
  };
  const say = (owner: DemoBot | DemoGroup, message: Message) => {
    owner.messages.push(message);
    owner.activeLeafId = message.id;
    owner.tasks[0]!.updatedAt = message.at;
    emit({ kind: "message", threadId: owner.threadId, message });
  };

  function send(owner: DemoBot | DemoGroup, responder: DemoBot, body: Json): Response {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const sendId = typeof body.sendId === "string" ? body.sendId : "";
    if (!text || !sendId) return json(400, { error: "text and sendId are required" });
    // the same send arriving twice (a retry from the outbox) is one message
    const already = owner.messages.find((message) => message.sendId === sendId);
    if (already) return json(202, { ok: true, threadId: owner.threadId, message: already });
    const mine: Message = { id: id("m"), at: now(), parentId: owner.messages.at(-1)?.id ?? null, role: "user", kind: "text", text, sendId, requestPending: true };
    say(owner, mine);
    patchBot(responder, { busy: true, activity: "working" });
    later(replyDelay, () => {
      say(owner, { id: id("m"), at: now(), parentId: mine.id, role: "bot", kind: "text", text: REPLIES[replies++ % REPLIES.length]!, requestMessageId: mine.id, ...(owner === responder ? {} : from(responder)) });
      patchBot(responder, { busy: false, activity: "idle" });
      mine.requestPending = false;
      emit({ kind: "message.patch", threadId: owner.threadId, message: mine });
    });
    return json(202, { ok: true, threadId: owner.threadId, message: mine });
  }

  function events(signal?: AbortSignal | null): Response {
    const encoder = new TextEncoder();
    let write: ((text: string) => void) | undefined;
    let beat: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (write) streams.delete(write); clearInterval(beat); };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        write = (text) => { try { controller.enqueue(encoder.encode(text)); } catch { stop(); } };
        streams.add(write);
        write(`data: ${JSON.stringify({ kind: "hello", cursor: `demo:${seq}`, resumed: false })}\n\n`);
        beat = setInterval(() => write?.(`data: ${JSON.stringify({ kind: "ping" })}\n\n`), 10_000);
        signal?.addEventListener("abort", () => { stop(); try { controller.close(); } catch {} }, { once: true });
      },
      cancel: stop,
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  async function route(method: string, path: string, body: Json, signal?: AbortSignal | null): Promise<Response> {
    if (method === "GET") {
      if (path === "/api/events") return events(signal);
      if (path === "/api/auth/session") return json(200, { kind: "session", id: "demo", label: "Demo", scopes: ["admin", "client"], expiresAt: now() + 365 * 24 * 60 * MINUTE });
      if (path === "/api/bots") return json(200, { bots, groups, sections: [], computerControl: {}, botQueuedMessages: {}, cursor: `demo:${seq}` });
      if (path === "/api/config") return json(200, shapes.config);
      if (path === "/api/instances") return json(200, { instances: [shapes.instance] });
      if (path === "/api/notifications") return json(200, { notifications });
      if (path === "/api/routines") return json(200, { routines: [], runs: [] });
      if (path === "/api/webhooks") return json(200, { webhooks: [], attempts: [], ingress: { available: false } });
      if (/^\/api\/threads\/[^/]+\/messages$/.test(path)) return json(200, { messages: [], hasMore: false });
      return json(404, { error: "not found" });
    }
    const [, kind, ownerId, action] = /^\/api\/(bots|groups)\/([^/]+)(?:\/([a-z-]+))?$/.exec(path) ?? [];
    const bot = kind === "bots" ? bots.find((one) => one.id === ownerId) : undefined;
    const group = kind === "groups" ? groups.find((one) => one.id === ownerId) : undefined;
    if (method === "POST" && action === "messages" && bot) return send(bot, bot, body);
    if (method === "POST" && action === "messages" && group) return send(group, bots.find((one) => group.memberIds.includes(one.id))!, body);
    if (method === "POST" && action === "read" && bot) {
      for (const one of bot.tasks) one.unread = false;
      patchBot(bot, { unread: false });
      return json(200, { ok: true, bot: withoutMessages(bot) });
    }
    if (method === "POST" && action === "read" && group) { group.unread = false; emit({ kind: "group", group: withoutMessages(group) }); return json(200, { ok: true }); }
    if (method === "PATCH" && bot && !action) {
      const patch: Json = {};
      for (const key of ["name", "color", "pinned", "mascotBody", "unread"]) if (key in body) patch[key] = body[key];
      patchBot(bot, patch);
      return json(200, { bot: withoutMessages(bot) });
    }
    if (method === "POST" && path === "/api/bots") {
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : "New bot";
      const botId = id("bot"), threadId = id("thread");
      const created: DemoBot = {
        ...(shapes.bot as Json), id: botId, threadId, mainThreadId: threadId, activeLeafId: null, name, color: typeof body.color === "string" ? body.color : "blue",
        ...(typeof body.mascotBody === "string" ? { mascotBody: body.mascotBody } : {}), createdAt: now(), unread: false, busy: false, activity: "idle", messages: [],
        tasks: [{ ...(shapes.task as Json), threadId, title: "New task", createdAt: now(), updatedAt: now(), unread: false }],
      };
      bots.push(created);
      emit({ kind: "bot", bot: created });
      return json(201, { bot: created });
    }
    if (method === "DELETE" && bot && !action) {
      bots.splice(bots.indexOf(bot), 1);
      emit({ kind: "bot.deleted", botId: bot.id });
      return json(200, { ok: true });
    }
    if (path.startsWith("/api/notifications")) {
      const read = notifications.filter((note) => !note.read).map((note) => { note.read = true; return note.id; });
      if (read.length) emit({ kind: "notifications.read", ids: read });
      return json(200, { ok: true });
    }
    if (path === "/api/mobile/presence") return json(200, { ok: true });
    return json(403, { error: readOnly, code: "demo" });
  }

  return {
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(request?.url ?? String(input), "https://demo.invalid");
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      let body: Json = {};
      if (method !== "GET" && method !== "HEAD") {
        const raw = request ? await request.clone().text().catch(() => "") : typeof init?.body === "string" ? init.body : "";
        try { const parsed: unknown = JSON.parse(raw || "{}"); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Json; } catch {}
      }
      return route(method, url.pathname, body, init?.signal ?? request?.signal);
    },
    close() { for (const timer of timers) clearTimeout(timer); timers.clear(); streams.clear(); },
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
