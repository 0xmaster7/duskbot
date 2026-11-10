// "Your Mac" for a linked VPS's bots. The owner's Mac app long-polls this server through its own signed-in link (no
// port opens on the Mac); bot turns hand it jobs through the device MCP server, and every call is the engine's own tool
// call, so it shows in the chat like any other.
//
// Open risk, accepted by the owner when they leave the switches on: whoever controls this server (its root, or a bot
// turn that passes the owner test) can run anything on the owner's Mac as the owner, for as long as the Mac app is
// linked. Guarded by: only an admin, non-browser session that is not a team member's can take jobs; only the owner's own
// turns may call; a global switch and a per-bot one; the Mac app logs every action it runs.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import { isMacToolName, type MacControlStatus, type MacToolName } from "../../shared/mac-control.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import type { PromptPart } from "../system-prompt.ts";
import { MAC_OFFLINE_TEXT, MAC_PROMPT } from "./instructions.ts";
import { macJobOutcome, MacJobs, MAC_RESULT_MAX_BYTES, type MacDownload } from "./jobs.ts";
import { MAC_TOOLS, macErrorResult, macJobTimeoutMs, macToolCallProblem, type MacToolResult } from "./tools.ts";

type Turn = { botId: string; threadId: string; generation: string };
type MacBot = { id: string; name: string; macControl?: boolean };

/** a Mac not seen for this long no longer gets the tools mounted */
const FORGET_MS = 30 * 24 * 60 * 60_000;
const SAVE_SEEN_MS = 10 * 60_000;
const NOT_HOST = "Only the owner's own Dusk app on their Mac can serve this server's bots.";
const OFF_TEXT = "Using the person's Mac is switched off for this bot or in Settings.";
const NOT_OWNER_TEXT = "This conversation can't use the person's Mac: only the owner's own turns can.";

export interface MacControlDeps {
  dataDir: string;
  /** One person owns this server (not a shared workspace, a team or a Cloud home) and loopback is the owner. */
  offered(): boolean;
  enabled(): boolean;
  setEnabled(enabled: boolean): void;
  ownerOrAdmin(auth: RequestAuth): boolean;
  live(auth: RequestAuth): boolean;
  bot(id: string): MacBot | null | undefined;
  /** Whose things the turn may use; null when it is not provably the owner's own turn. */
  turnOwner(turn: Turn): string | null;
  active(turn: Turn): boolean;
  /** A file in the bot's own folders or this conversation's attachments. */
  openFile(turn: Turn, source: string): Promise<MacDownload>;
  /** A file in the bot's cloud computer's home. */
  computerFile(botId: string, source: string): Promise<MacDownload>;
  now?(): number;
  log?(line: string): void;
}

/** The session the Mac app signed in with: an admin's own device, never a browser sign-in, a team member or a move-in. */
export function macHostSession(auth: RequestAuth): boolean {
  if (auth.kind !== "session") return false;
  const { session } = auth;
  return auth.scopes.includes("admin") && session.cookieOnly !== true && session.moveIn === undefined &&
    (session.teamRole === undefined || session.teamRole === "owner") && session.membershipAuthority === undefined;
}

const cleanName = (value: string | null) => (value ?? "").replace(/[^\p{L}\p{N} '._-]/gu, "").trim().slice(0, 60) || null;

export function createMacControl(deps: MacControlDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const file = join(deps.dataDir, "mac-control.json");
  let seen: { name: string | null; lastSeenAt: number | null } = { name: null, lastSeenAt: null };
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as { name?: unknown; lastSeenAt?: unknown };
    seen = { name: typeof saved.name === "string" ? saved.name : null, lastSeenAt: typeof saved.lastSeenAt === "number" ? saved.lastSeenAt : null };
  } catch { /* never linked */ }
  let savedAt = seen.lastSeenAt ?? -Infinity;
  const remember = (name: string | null) => {
    const changed = name !== null && name !== seen.name;
    seen = { name: name ?? seen.name, lastSeenAt: now() };
    if (!changed && now() - savedAt < SAVE_SEEN_MS) return;
    savedAt = now();
    try { writeFileSync(file, JSON.stringify(seen), { mode: 0o600 }); }
    catch (error) { log(`mac control: could not record the Mac (${error instanceof Error ? error.message : String(error)})`); }
  };
  const jobs = new MacJobs(now);
  const available = () => deps.offered() && seen.lastSeenAt !== null && now() - seen.lastSeenAt < FORGET_MS;
  const allowed = (bot: MacBot | null | undefined, turn: Turn): string | null => {
    if (!bot) return "This bot no longer exists.";
    if (!available()) return MAC_OFFLINE_TEXT;
    if (!deps.enabled() || bot.macControl === false) return OFF_TEXT;
    return deps.turnOwner(turn) === null ? NOT_OWNER_TEXT : null;
  };

  function status(): MacControlStatus {
    return { available: available(), enabled: deps.enabled(), online: jobs.online(), name: seen.name, lastSeenAt: seen.lastSeenAt };
  }

  async function call(params: unknown, turn: Turn, assertActive: () => void): Promise<MacToolResult> {
    const { name, arguments: raw } = (params && typeof params === "object" ? params : {}) as { name?: unknown; arguments?: unknown };
    const args = (raw ?? {}) as Record<string, unknown>;
    const problem = macToolCallProblem(name, args);
    if (problem || !isMacToolName(name)) return macErrorResult(problem ?? "Unknown Mac tool.");
    assertActive();
    const bot = deps.bot(turn.botId);
    const refusal = allowed(bot, turn);
    if (refusal || !bot) return macErrorResult(refusal ?? "This bot no longer exists.");
    if (!jobs.online()) return macErrorResult(MAC_OFFLINE_TEXT);
    let download: MacDownload | undefined;
    if (name === "mac_save_from_cloud") {
      try {
        download = args.from === "computer" ? await deps.computerFile(bot.id, String(args.source)) : await deps.openFile(turn, String(args.source));
      } catch (error) {
        return macErrorResult(`Could not read ${String(args.source)}: ${error instanceof Error ? error.message : String(error)}`);
      }
      assertActive();
    }
    const outcome = await jobs.request({
      tool: name as MacToolName, args, bot: { id: bot.id, name: bot.name }, timeoutMs: macJobTimeoutMs(name, args),
      active: () => deps.active(turn) && allowed(deps.bot(turn.botId), turn) === null, offlineText: MAC_OFFLINE_TEXT, ...(download ? { file: download } : {}),
    });
    assertActive();
    if (!outcome.ok) return macErrorResult(outcome.error);
    return { content: [{ type: "text", text: outcome.result.text }, ...(outcome.result.image ? [{ type: "image" as const, ...outcome.result.image }] : [])] };
  }

  const routes: RouteHandler = async ({ req, res, path, method, auth, json, readBody, url }) => {
    if (path !== "/api/mac" && !path.startsWith("/api/mac/")) return PASS;
    res.setHeader("cache-control", "no-store");
    if (path === "/api/mac") {
      if (!deps.ownerOrAdmin(auth)) return json(res, 403, { error: "Only the owner can change what bots may do on their Mac." });
      if (method === "GET") return json(res, 200, status());
      if (method === "PUT") {
        const body = await readBody(req, 1024) as Record<string, unknown> | null;
        if (typeof body?.enabled !== "boolean") return json(res, 400, { error: "enabled must be true or false" });
        deps.setEnabled(body.enabled);
        return json(res, 200, status());
      }
      return json(res, 405, { error: "method not allowed" });
    }
    if (!path.startsWith("/api/mac/self/")) return json(res, 404, { error: "not found" });
    if (!deps.offered() || !macHostSession(auth)) return json(res, 403, { error: NOT_HOST });
    if (!deps.live(auth)) return json(res, 401, { error: "Session expired" });
    if (path === "/api/mac/self/jobs" && method === "GET") {
      remember(cleanName(url.searchParams.get("name")));
      const gone = new AbortController();
      res.once("close", () => { if (!res.writableEnded) gone.abort(); });
      const job = await jobs.poll(gone.signal);
      if (!deps.live(auth)) return json(res, 401, { error: "Session expired" });
      return json(res, 200, { job, enabled: deps.enabled() });
    }
    const one = /^\/api\/mac\/self\/jobs\/([\w-]{1,64})\/(result|file)$/.exec(path);
    if (one?.[2] === "result" && method === "POST") {
      const outcome = macJobOutcome.safeParse(await readBody(req, MAC_RESULT_MAX_BYTES + 65_536));
      if (!outcome.success) return json(res, 400, { error: "Send { ok: true, result: { text } } or { ok: false, error }." });
      return jobs.complete(one[1]!, outcome.data) ? json(res, 200, { ok: true }) : json(res, 409, { error: "This job expired; it will not be replayed." });
    }
    if (one?.[2] === "file" && method === "GET") {
      const download = jobs.file(one[1]!);
      if (!download) return json(res, 404, { error: "no such file" });
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(download.bytes) });
      await pipeline(download.open(), res).catch((error) => log(`mac control: a download stopped (${error instanceof Error ? error.message : String(error)})`));
      return;
    }
    return json(res, 404, { error: "not found" });
  };

  return {
    status,
    routes,
    /** The device server mounts for this turn because of the Mac (it may also mount for the phone). */
    mounts: (bot: MacBot, turn: Turn) => allowed(bot, turn) === null,
    promptPart: (bot: MacBot, turn: Turn): PromptPart => ({ id: "mac", label: "Your Mac", text: allowed(bot, turn) === null ? MAC_PROMPT : "" }),
    /** The bot settings preview: the Mac as the owner's own turn would see it. */
    previewPart: (bot: MacBot): PromptPart => ({ id: "mac", label: "Your Mac", text: available() && deps.enabled() && bot.macControl !== false ? MAC_PROMPT : "" }),
    tools: (turn: Turn) => (allowed(deps.bot(turn.botId), turn) === null ? [...MAC_TOOLS] : []),
    handles: (name: unknown): name is MacToolName => isMacToolName(name),
    call,
    close: () => jobs.close(),
  };
}

export type MacControl = ReturnType<typeof createMacControl>;
