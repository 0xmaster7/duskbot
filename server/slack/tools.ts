import { open } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { basename } from "node:path";
import { z } from "zod";
import type { json as sendJson } from "../harness/http.ts";
import { botFileSource, PageBundleError, type BotFolders } from "../pages/bundle.ts";
import { PASS } from "../routes/table.ts";
import { SlackApiError, type SlackApi } from "./api.ts";
import { fromSlackText, splitSlackText, toSlackMrkdwn } from "./mrkdwn.ts";

export const SLACK_TOOL_PATH = /^\/api\/internal\/slack\/(slack_[a-z]+)$/;
export interface SlackToolsDeps {
  api: SlackApi;
  link(botId: string): { botToken: string; botUserId: string; teamId: string; handle?: string } | null;
  markOutside(threadId: string): void;
  log?: (line: string) => void;
}
export interface SlackToolContext {
  method: string;
  path: string;
  res: ServerResponse;
  json: typeof sendJson;
  botId: string;
  threadId: string;
  readBody(): Promise<unknown>;
  folders: BotFolders;
  requireActive?(): void;
}

const channel = z.string().min(1).max(100);
const text = z.string().min(1).max(40_000);
const ts = z.string().min(1).max(32).regex(/^[0-9]{1,20}\.[0-9]{6}$/);
const schemas = {
  slack_channels: z.object({}).strict(),
  slack_post: z.object({ channel, text, thread_ts: ts.optional() }).strict(),
  slack_reply: z.object({ link: z.string().min(1).max(2048), text }).strict(),
  slack_react: z.object({ channel, ts, emoji: z.string().min(1).max(66) }).strict(),
  slack_upload: z.object({ path: z.string().min(1).max(4096), channel, thread_ts: ts.optional(), comment: z.string().max(4000).optional() }).strict(),
  slack_read: z.object({ channel, thread_ts: ts.optional(), limit: z.number().int().min(1).max(100).default(20) }).strict(),
  slack_dm: z.object({ user: z.string().min(1).max(254), text }).strict(),
};
type ToolName = keyof typeof schemas;
type Link = NonNullable<ReturnType<SlackToolsDeps["link"]>>;
type Channel = { id: string; name: string; is_private?: boolean; is_member?: boolean };
type User = { id: string; name?: string; real_name?: string; profile?: { display_name?: string; real_name?: string } };
type Message = { ts: string; user?: string; bot_id?: string; text?: string; thread_ts?: string; reply_count?: number };
type Answer = { ok: true; text: string } | { error: string };
const CHANNEL_ID = /^[CGD][A-Z0-9]{2,30}$/;
const USER_ID = /^U[A-Z0-9]{2,30}$/;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const CACHE_MS = 5 * 60_000;
const success = (value: unknown): Answer => ({ ok: true, text: JSON.stringify(value) });

class ToolRefusal extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function body<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ToolRefusal(400, "Use the Slack tool's fields and limits exactly as listed.");
  return parsed.data;
}

function messageLink(value: string): { channel: string; thread_ts: string } {
  const bad = () => new ToolRefusal(400, "Use a Slack message link (Copy link on the message).");
  let url: URL;
  try { url = new URL(value); } catch { throw bad(); }
  const match = /^\/archives\/([CGD][A-Z0-9]{2,30})\/p([0-9]{16})$/.exec(url.pathname);
  const queryTs = url.searchParams.get("thread_ts");
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.slack\.com$/.test(url.hostname) || url.port || url.username || url.password || url.hash || !match ||
    (queryTs !== null && !ts.safeParse(queryTs).success)) throw bad();
  const digits = match[2]!;
  return { channel: match[1]!, thread_ts: queryTs ?? `${digits.slice(0, -6)}.${digits.slice(-6)}` };
}

function slackRefusal(error: SlackApiError, link: Link): ToolRefusal {
  const code = /^[a-z][a-z0-9_]{0,63}$/.test(error.code) && !error.code.includes(link.botToken) ? error.code : "bad_response";
  const messages: Record<string, string> = {
    not_in_channel: `The bot isn't in that channel. Ask someone there to type /invite @${link.handle?.replace(/^@/, "") || "bot"}.`,
    channel_not_found: "Slack can't find that channel.",
    ratelimited: "Slack is rate limiting this bot; try again in a minute.",
    missing_scope: "This bot's Slack app lacks a permission for that. Remove it from Slack and add it again.",
  };
  return new ToolRefusal(code === "ratelimited" ? 429 : 400, messages[code] ?? `Slack refused that: ${code}`);
}

export function createSlackToolRoutes(deps: SlackToolsDeps): (ctx: SlackToolContext) => Promise<typeof PASS | void> {
  const channelCache = new Map<string, { token: string; until: number; channels: Channel[] }>();
  const userCache = new Map<string, { token: string; until: number; name: string }>();
  const { api } = deps;

  async function channels(botId: string, link: Link): Promise<Channel[]> {
    const cached = channelCache.get(botId);
    if (cached && cached.token === link.botToken && cached.until > Date.now()) return cached.channels;
    const found: Channel[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const result = await api.call<{ channels: Channel[]; response_metadata?: { next_cursor?: string } }>("conversations.list", link.botToken,
        { types: "public_channel,private_channel", exclude_archived: true, limit: 200, cursor });
      found.push(...result.channels);
      cursor = result.response_metadata?.next_cursor || undefined;
      if (cursor && seen.has(cursor)) throw new SlackApiError("bad_response");
      if (cursor) seen.add(cursor);
    } while (cursor);
    channelCache.set(botId, { token: link.botToken, until: Date.now() + CACHE_MS, channels: found });
    return found;
  }

  async function resolveChannel(value: string, ctx: SlackToolContext, link: Link): Promise<string> {
    if (CHANNEL_ID.test(value)) return value;
    const name = value.replace(/^#/, "");
    const found = (await channels(ctx.botId, link)).find((entry) => entry.name === name);
    if (!found) throw new ToolRefusal(404, `No channel named #${name} that this bot can see.`);
    return found.id;
  }

  async function userName(id: string, ctx: SlackToolContext, link: Link): Promise<string> {
    const key = `${ctx.botId}:${id}`;
    const cached = userCache.get(key);
    if (cached && cached.token === link.botToken && cached.until > Date.now()) return cached.name;
    const { user } = await api.call<{ user: User }>("users.info", link.botToken, { user: id });
    const name = user.profile?.display_name || user.profile?.real_name || user.real_name || user.name || id;
    userCache.set(key, { token: link.botToken, until: Date.now() + CACHE_MS, name });
    return name;
  }

  async function post(channel: string, text: string, thread_ts: string | undefined, ctx: SlackToolContext, link: Link): Promise<Answer> {
    let firstTs = "";
    for (const part of splitSlackText(toSlackMrkdwn(text))) {
      const result = await api.queued(channel, () => {
        ctx.requireActive?.();
        return api.call<{ ts: string }>("chat.postMessage", link.botToken, { channel, text: part, thread_ts, mrkdwn: true });
      });
      firstTs ||= result.ts;
    }
    return success({ channel, ts: firstTs });
  }

  async function run(name: ToolName, raw: unknown, ctx: SlackToolContext, link: Link): Promise<Answer> {
    switch (name) {
      case "slack_channels": {
        body(schemas.slack_channels, raw);
        const list = await channels(ctx.botId, link);
        deps.markOutside(ctx.threadId);
        return success(list.map((entry) => ({ id: entry.id, name: entry.name, private: entry.is_private === true, member: entry.is_member === true })));
      }
      case "slack_post": {
        const args = body(schemas.slack_post, raw);
        return post(await resolveChannel(args.channel, ctx, link), args.text, args.thread_ts, ctx, link);
      }
      case "slack_reply": {
        const args = body(schemas.slack_reply, raw);
        const target = messageLink(args.link);
        return post(target.channel, args.text, target.thread_ts, ctx, link);
      }
      case "slack_react": {
        const args = body(schemas.slack_react, raw);
        const emoji = args.emoji.replace(/^:|:$/g, "");
        if (!/^[a-z0-9_+'-]{1,64}$/.test(emoji)) throw new ToolRefusal(400, "Use a Slack emoji name without colons, such as eyes or +1.");
        const channel = await resolveChannel(args.channel, ctx, link);
        ctx.requireActive?.();
        try { await api.call("reactions.add", link.botToken, { channel, timestamp: args.ts, name: emoji }); }
        catch (error) { if (!(error instanceof SlackApiError) || error.code !== "already_reacted") throw error; }
        return success({ channel, ts: args.ts });
      }
      case "slack_upload": {
        const args = body(schemas.slack_upload, raw);
        const path = await botFileSource(args.path, ctx.folders);
        const file = await open(path, "r");
        let bytes: Buffer;
        try {
          const info = await file.stat();
          if (!info.isFile()) throw new ToolRefusal(400, "Choose a file in your working folder.");
          if (info.size > MAX_UPLOAD_BYTES) throw new ToolRefusal(400, "Slack uploads can be at most 100 MB.");
          bytes = Buffer.alloc(info.size + 1);
          let count = 0;
          while (count < bytes.length) {
            const read = await file.read(bytes, count, bytes.length - count, null);
            if (!read.bytesRead) break;
            count += read.bytesRead;
          }
          if (count > MAX_UPLOAD_BYTES || count > info.size) throw new ToolRefusal(400, "The file grew while being read. Choose a file up to 100 MB and try again.");
          bytes = bytes.subarray(0, count);
        } finally { await file.close(); }
        const channel = await resolveChannel(args.channel, ctx, link);
        ctx.requireActive?.();
        const filename = basename(path);
        const upload = await api.call<{ upload_url: string; file_id: string }>("files.getUploadURLExternal", link.botToken, { filename, length: bytes.length });
        ctx.requireActive?.();
        await api.putUpload(upload.upload_url, bytes, "application/octet-stream");
        ctx.requireActive?.();
        await api.call("files.completeUploadExternal", link.botToken, { files: [{ id: upload.file_id, title: filename }], channel_id: channel,
          thread_ts: args.thread_ts, initial_comment: args.comment });
        return success({ channel, file_id: upload.file_id });
      }
      case "slack_read": {
        const args = body(schemas.slack_read, raw);
        const channel = await resolveChannel(args.channel, ctx, link);
        const result = await api.call<{ messages: Message[] }>(args.thread_ts ? "conversations.replies" : "conversations.history", link.botToken,
          { channel, ts: args.thread_ts, limit: args.limit });
        const messages = [];
        for (const message of result.messages) {
          const user = message.user ?? message.bot_id ?? "";
          const names = new Map<string, string>();
          if (message.user) names.set(message.user, await userName(message.user, ctx, link));
          for (const mention of (message.text ?? "").matchAll(/<@([A-Za-z0-9]+)(?:\|[^>]*)?>/g)) {
            const id = mention[1]!;
            if (!names.has(id)) names.set(id, await userName(id, ctx, link));
          }
          messages.push({ ts: message.ts, user, name: names.get(user) ?? user,
            text: fromSlackText(message.text ?? "", (id) => names.get(id)), ...(message.thread_ts ? { thread_ts: message.thread_ts } : {}),
            ...(message.reply_count !== undefined ? { reply_count: message.reply_count } : {}) });
        }
        deps.markOutside(ctx.threadId);
        return success({ channel, messages });
      }
      case "slack_dm": {
        const args = body(schemas.slack_dm, raw);
        let user = args.user;
        if (!USER_ID.test(user)) {
          if (!z.email().safeParse(user).success) throw new ToolRefusal(400, "Use a Slack user id like U0123, or an email address.");
          const found = await api.call<{ user: User }>("users.lookupByEmail", link.botToken, { email: user });
          user = found.user.id;
        }
        ctx.requireActive?.();
        const result = await api.call<{ channel: { id: string } }>("conversations.open", link.botToken, { users: user });
        return post(result.channel.id, args.text, undefined, ctx, link);
      }
    }
  }

  return async (ctx) => {
    const match = SLACK_TOOL_PATH.exec(ctx.path);
    if (ctx.method !== "POST" || !match || !Object.hasOwn(schemas, match[1]!)) return PASS;
    const raw = await ctx.readBody();
    ctx.requireActive?.();
    const link = deps.link(ctx.botId);
    let status = 200, answer: Answer;
    if (!link) {
      status = 409;
      answer = { error: "This bot isn't connected to Slack. Ask the person to add it in the bot's Slack settings." };
    } else {
      try { answer = await run(match[1] as ToolName, raw, ctx, link); }
      catch (error) {
        const refusal = error instanceof SlackApiError ? slackRefusal(error, link) : error;
        if (refusal instanceof ToolRefusal || refusal instanceof PageBundleError) {
          status = refusal instanceof PageBundleError ? 400 : refusal.status;
          answer = { error: refusal.message };
        } else {
          deps.log?.("Slack tool failed.");
          status = 400;
          answer = { error: "Slack could not finish that request. Try again shortly." };
        }
      }
    }
    ctx.requireActive?.();
    if (link) {
      if ("text" in answer) answer.text = answer.text.replaceAll(link.botToken, "[redacted]");
      else answer.error = answer.error.replaceAll(link.botToken, "[redacted]");
    }
    ctx.json(ctx.res, status, answer);
  };
}
