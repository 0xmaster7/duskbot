// "Add your VPS": the app opens a one-time setup session at the link service, shows the one command, follows the install
// step by step, opens the sealed result, signs this app in to the new server, saves it as a server, then signs the AI in
// from this mac and moves everything there (backup first, own-home move, check, switch, then this mac emptied).
// every secret is kept protected (safeStorage in main); the link service only ever sees verifiers and sealed blobs.
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { createRelayClient, createTunnelProxy, newLinkKeys, openResult } from "./vps-link-protocol.mjs";

export const STEP_IDS = Object.freeze(["check", "basics", "docker", "user", "node", "app", "engines", "service", "address", "desktop", "link"]);
const STATUSES = new Set(["running", "done", "failed", "skipped"]);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SKILL_KINDS = new Set(["skill", "imported-skill", "library-skill"]);
const ROUTINE_KINDS = new Set(["routine", "call", "webhook", "app-event"]);
const CLAUDE_TOKEN = /sk-ant-oat01-[A-Za-z0-9_-]{20,}/;

/** a plain sentence for a person, never a stack or a status code alone */
const plain = (error, fallback) => {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  return message && message.length < 300 && !/^\w*Error\b|ECONN|fetch failed|ENOTFOUND/.test(message) ? message : fallback;
};

/**
 * @param {{
 *   base: string,
 *   fetch?: typeof fetch,
 *   serverFetch: typeof fetch,
 *   store: { read(): unknown, write(value: unknown): void },
 *   protect(text: string): Promise<string>,
 *   unprotect(text: string): Promise<string>,
 *   label(): string,
 *   saveServer(server: { origin: string, name: string }): string,
 *   forgetServer(id: string): void,
 *   retarget?(from: string, to: string): void,
 *   switchTo(id: string): Promise<void> | void,
 *   pin?(host: string, spki: string): void,
 *   ownHome: { start(id: string): Promise<unknown>, view(): any, away(): boolean, home(): any, chosen(): any, retry?(): Promise<void>, trouble?(): { error: string, retryAt: number } | null },
 *   ownHomeReset(): void,
 *   localRequest(route: string, init?: RequestInit): Promise<Response>,
 *   backups: { save(name: string, bytes: AsyncIterable<Uint8Array> | Uint8Array): Promise<{ file: string, bytes: number }>, open(file: string): Promise<{ body: any, size: number }>, remove?(file: string): void },
 *   localCredentials: { codexAuth(): Promise<string | null>, claudeCli(): Promise<string | null>, claudeToken(cli: string, signal: AbortSignal): Promise<string> },
 *   relaunch(): void,
 *   dataSize?(): Promise<number | null>,
 *   proxyFactory?: typeof createTunnelProxy,
 *   now?(): number,
 *   onChange?(view: any): void,
 *   log?(line: string): void,
 *   pollMs?: number,
 * }} deps
 */
export function createVpsLink(deps) {
  const { base, serverFetch, store, protect, unprotect, ownHome, localRequest, now = Date.now, onChange = () => {}, log = () => {}, pollMs = 1000 } = deps;
  const relay = createRelayClient({ base, fetch: deps.fetch ?? fetch });
  const makeProxy = deps.proxyFactory ?? createTunnelProxy;
  const proxies = new Map();
  const proxyStarts = new Map();
  const sessionChecks = new Map();
  const signIns = new Map();
  let state = read();
  let watching = null, moveTimer = null, closed = false, lastError = null;
  let setupGeneration = 0, setupAbort = null;

  function read() {
    const value = (() => { try { return store.read(); } catch { return null; } })();
    return {
      v: 1,
      pending: record(value?.pending) ? value.pending : null,
      links: Array.isArray(value?.links) ? value.links.filter(record) : [],
      current: typeof value?.current === "string" ? value.current : null,
      move: record(value?.move) ? value.move : null,
      backups: Array.isArray(value?.backups) ? value.backups.filter(record) : [],
    };
  }
  function write() { store.write(state); onChange(view()); }
  const currentLink = () => state.links.find((link) => link.id === state.current) ?? null;

  // the install's live terminal: lines each step streams while it runs. kept in memory only, never in the store
  let live = { id: null, steps: {}, feed: [] };
  const LIVE_STEP_LINES = 200;
  const LIVE_FEED = 400;
  function liveFor(id) { if (live.id !== id) live = { id, steps: {}, feed: [] }; return live; }
  function steps() {
    const seen = state.pending?.steps ?? (currentLink() ? Object.fromEntries(STEP_IDS.map((id) => [id, { status: "done" }])) : {});
    const lines = state.pending && live.id === state.pending.id ? live.steps : {};
    return STEP_IDS.map((id) => ({
      id, status: seen[id]?.status ?? "waiting", ...(seen[id]?.log ? { log: seen[id].log } : {}),
      ...(lines[id]?.cmd ? { cmd: lines[id].cmd } : {}), ...(lines[id]?.lines?.length ? { lines: lines[id].lines } : {}),
    }));
  }
  function view() {
    const link = currentLink();
    const pending = state.pending;
    const move = state.move && state.move.linkId === link?.id ? state.move : null;
    let stage = "idle";
    if (move) stage = move.step === "done" ? "moved" : "moving";
    else if (pending) stage = pending.state === "installing" || pending.state === "linking" ? "installing" : "command";
    else if (link) stage = "linked";
    if (lastError && stage === "idle") stage = "error";
    return {
      stage,
      command: pending ? pending.command : null,
      expiresAt: pending?.expiresAt ?? null,
      steps: steps(),
      terminal: state.pending && live.id === state.pending.id ? live.feed : [],
      server: link ? { id: link.envId, name: link.name, origin: link.origin } : null,
      mode: link?.mode ?? null,
      error: lastError,
      move: move ? { step: move.step, status: move.status, ...(move.chats ? { chats: move.chats } : {}), ...(move.waitingFor ? { waitingFor: move.waitingFor } : {}), ...(move.error ? { error: move.error } : {}), ...(move.retryAt ? { retryAt: move.retryAt } : {}), ...(move.backupId ? { backupId: move.backupId } : {}), ...(move.kept ? { kept: true } : {}) } : null,
    };
  }

  // ---- setup ----

  function invalidateSetup() {
    setupGeneration += 1;
    setupAbort?.abort();
    setupAbort = null;
  }

  function revokeUnused(made) {
    void relay.cancel(made.id, made.watch).catch((error) => log(`vps link: unused command could not be cancelled (${error?.message ?? error})`));
  }

  async function start() {
    if (closed) return view();
    invalidateSetup();
    const generation = setupGeneration;
    const abort = new AbortController();
    setupAbort = abort;
    const active = () => !closed && !abort.signal.aborted && generation === setupGeneration;
    if (state.pending) await cancelPending();
    if (!active()) return view();
    lastError = null;
    const keys = newLinkKeys();
    let made;
    try {
      made = await relay.create({ verifier: keys.verifier, appPub: keys.pub, label: deps.label().slice(0, 60) }, abort.signal);
      if (!active()) { revokeUnused(made); return view(); }
      const [watchP, privP] = await Promise.all([protect(made.watch), protect(keys.priv)]);
      if (!active()) { revokeUnused(made); return view(); }
      const token = `${made.id}-${keys.secret}`;
      state.pending = {
        id: made.id, state: "waiting", after: 0, steps: {}, createdAt: now(), expiresAt: made.expiresAt,
        command: `curl -fsSL ${made.base}/i/${token} | sh`, watchP, privP, pub: keys.pub,
      };
      state.current = null;
      write();
      follow();
      return view();
    } catch (error) {
      if (made) revokeUnused(made);
      if (!active()) return view();
      lastError = plain(error, "The link service did not answer. Check your internet and try again.");
      onChange(view());
      throw new Error(lastError);
    } finally {
      if (setupAbort === abort) setupAbort = null;
    }
  }

  async function cancelPending() {
    const pending = state.pending;
    stopFollowing();
    if (pending) {
      state.pending = null;
      write();
      void unprotect(pending.watchP).then((watch) => relay.cancel(pending.id, watch)).catch((error) => log(`vps link: cancel did not reach the link service (${error?.message ?? error})`));
      await proxyStarts.get(pending.id)?.catch(() => {});
      if (!state.links.some((link) => link.id === pending.id)) {
        await proxies.get(pending.id)?.close();
        proxies.delete(pending.id);
      }
    }
  }

  async function cancel() {
    invalidateSetup();
    await cancelPending();
    return view();
  }

  function stopFollowing() { watching?.abort(); watching = null; }

  /** follows the install as it reports, through sleeps and lost connections, until linked, cancelled or expired */
  function follow() {
    if (watching || !state.pending) return;
    const abort = new AbortController();
    watching = abort;
    void (async () => {
      let failures = 0;
      while (!abort.signal.aborted && state.pending) {
        const pending = state.pending;
        try {
          const got = await relay.watch(pending.id, await unprotect(pending.watchP), pending.after, AbortSignal.any([abort.signal, AbortSignal.timeout(40_000)]));
          if (abort.signal.aborted || state.pending !== pending || closed) break;
          failures = 0;
          let changed = false;
          let streamed = false;
          for (const event of got.events ?? []) {
            pending.after = Math.max(pending.after, event.seq);
            if (!STATUSES.has(event.status) || typeof event.step !== "string") continue;
            if (Array.isArray(event.lines) || typeof event.cmd === "string") {
              const mirror = liveFor(pending.id);
              const lines = (Array.isArray(event.lines) ? event.lines : []).filter((line) => typeof line === "string").map((line) => line.slice(0, 400));
              const own = (mirror.steps[event.step] ??= { lines: [] });
              if (typeof event.cmd === "string") own.cmd = event.cmd.slice(0, 300);
              own.lines = own.lines.concat(lines).slice(-LIVE_STEP_LINES);
              mirror.feed = mirror.feed.concat(lines.map((text) => ({ step: event.step, text }))).slice(-LIVE_FEED);
              streamed = true;
              // a late batch never takes a finished step back to running
              if (event.status === "running" && pending.steps[event.step]) continue;
            }
            if (!STEP_IDS.includes(event.step)) continue;
            pending.steps[event.step] = { status: event.status, ...(event.status === "failed" && typeof event.log === "string" ? { log: event.log.slice(-4000) } : {}) };
            changed = true;
          }
          if (got.state === "installing" && pending.state === "waiting") { pending.state = "installing"; changed = true; }
          if (got.state === "linked") { pending.state = "linking"; write(); await finish(pending, got, abort.signal); continue; }
          if (got.state === "expired" || got.state === "cancelled") {
            state.pending = null;
            lastError = got.state === "expired" ? "This command expired before your server used it. Make a new one." : null;
            write();
            break;
          }
          if (changed) write();
          else if (streamed) onChange(view());
        } catch (error) {
          if (abort.signal.aborted) break;
          if (error?.status === 404) { state.pending = null; lastError = "This command expired. Make a new one."; write(); break; }
          failures += 1;
          await sleep(Math.min(15_000, 500 * 2 ** Math.min(failures, 5)), undefined, { signal: abort.signal }).catch(() => {});
        }
      }
      if (watching === abort) watching = null;
    })();
  }

  async function signInTo(origin, code, signal) {
    const response = await serverFetch(`${origin}/api/auth/pair`, {
      method: "POST", redirect: "error", credentials: "include", cache: "no-store",
      headers: { "content-type": "application/json", accept: "application/json", origin },
      body: JSON.stringify({ code, cookie: true, label: deps.label().slice(0, 60) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(typeof body?.error === "string" ? body.error : `Your server answered ${response.status}.`), { status: response.status });
    return body;
  }

  async function proxyFor(link) {
    if (closed) throw new Error("The app is closing.");
    if (proxyStarts.has(link.id)) return proxyStarts.get(link.id);
    if (proxies.has(link.id)) return proxies.get(link.id);
    const starting = (async () => {
      const [key, token] = await Promise.all([unprotect(link.keyP), unprotect(link.tokenP)]);
      if (closed) throw new Error("The app is closing.");
      let proxy = makeProxy({ base: link.base ?? base, id: link.id, key, token, port: link.port ?? 0, log });
      proxies.set(link.id, proxy);
      let origin;
      try {
        try { origin = await proxy.start(); }
        catch (error) {
          if (error?.code !== "EADDRINUSE" || closed) throw error;
          await proxy.close();
          proxy = makeProxy({ base: link.base ?? base, id: link.id, key, token, port: 0, log });
          proxies.set(link.id, proxy);
          origin = await proxy.start();
        }
        if (closed) throw new Error("The app is closing.");
        const port = Number(new URL(origin).port);
        if (link.mode === "relay" && link.origin !== origin) {
          if (link.origin) deps.retarget?.(link.origin, origin);
          link.origin = origin;
          link.port = port;
          write();
        }
        return proxy;
      } catch (error) {
        if (proxies.get(link.id) === proxy) proxies.delete(link.id);
        await proxy.close();
        throw error;
      }
    })();
    proxyStarts.set(link.id, starting);
    try { return await starting; }
    finally { if (proxyStarts.get(link.id) === starting) proxyStarts.delete(link.id); }
  }

  async function finish(pending, got, signal) {
    const active = () => !closed && !signal.aborted && state.pending === pending;
    let link = null;
    try {
      const priv = await unprotect(pending.privP);
      if (!active()) return;
      const result = openResult({ id: pending.id, priv, pub: pending.pub, vpsPub: got.vpsPub, sealed: got.sealed });
      const [keyP, tokenP] = await Promise.all([protect(result.tunnel.key), protect(result.tunnel.token)]);
      if (!active()) return;
      link = {
        id: pending.id, base, name: result.name, mode: result.mode, origin: result.mode === "direct" ? result.origin : null, port: null,
        spki: result.spki ?? null, environmentId: result.environmentId ?? null, envId: null, at: now(), keyP, tokenP,
      };
      if (link.mode === "direct") deps.pin?.(new URL(link.origin).host, link.spki);
      const proxy = await proxyFor(link);
      if (!active()) return;
      let paired;
      try { paired = await signInTo(link.origin, result.pairing.code, signal); }
      catch {
        if (!active()) return;
        const minted = await proxy.control("pair", { label: deps.label() });
        if (!active()) return;
        paired = await signInTo(link.origin, minted.code, signal);
      }
      if (!active()) return;
      const environmentId = paired?.environment?.environmentId;
      if (link.environmentId && environmentId && environmentId !== link.environmentId) throw new Error("A different server answered at that address, so this app did not link to it.");
      link.envId = deps.saveServer({ origin: link.origin, name: link.name });
      state.links = [...state.links.filter((entry) => entry.id !== link.id), link];
      state.pending = null;
      state.current = link.id;
      lastError = null;
      write();
    } catch (error) {
      if (!active()) return;
      log(`vps link: linking failed (${error?.message ?? error})`);
      state.pending = null;
      lastError = plain(error, "Your server finished installing, but this app could not link to it. Make a new command and run it again.");
      write();
    } finally {
      if (link && !state.links.some((saved) => saved.id === link.id)) {
        const proxy = proxies.get(link.id);
        proxies.delete(link.id);
        await proxy?.close();
      }
    }
  }

  /** this app's sign-in at the server, made again through the agent when it lapsed */
  async function signedIn(link) {
    if (sessionChecks.has(link.id)) return sessionChecks.get(link.id);
    const checking = (async () => {
      const proxy = await proxyFor(link);
      const response = await serverFetch(`${link.origin}/api/auth/session`, { credentials: "include", cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
      const body = response?.ok ? await response.json().catch(() => null) : null;
      if (body?.kind === "session") return proxy;
      const minted = await proxy.control("pair", { label: deps.label() });
      await signInTo(link.origin, minted.code);
      return proxy;
    })();
    sessionChecks.set(link.id, checking);
    try { return await checking; }
    finally { if (sessionChecks.get(link.id) === checking) sessionChecks.delete(link.id); }
  }

  async function serverCall(link, method, route, body) {
    const response = await serverFetch(`${link.origin}${route}`, {
      method, redirect: "error", credentials: "include", cache: "no-store",
      headers: { accept: "application/json", origin: link.origin, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(120_000),
    });
    const parsed = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(typeof parsed?.error === "string" ? parsed.error : `Your server answered ${response.status}.`), { status: response.status });
    return parsed;
  }
  function needLink() {
    const link = currentLink();
    if (!link?.origin) throw new Error("Link a server first.");
    return link;
  }

  // ---- ai sign-in: on this mac, then sent to the server over the sealed tunnel ----

  async function engines() {
    const link = needLink();
    await signedIn(link);
    return readEngines(link);
  }

  async function readEngines(link) {
    const { instances = [] } = await serverCall(link, "GET", "/api/instances?fresh=1");
    // the server names the engine in driverKind (claudeAgent, codex); older servers used driver
    const kindOf = (instance) => {
      const driver = instance?.driverKind ?? instance?.driver;
      if (instance?.instanceId === "claude" && (driver === "claudeAgent" || driver === "claude")) return "claude";
      if (instance?.instanceId === "codex" && driver === "codex") return "codex";
      return null;
    };
    return instances.filter((instance) => kindOf(instance) !== null).map((instance) => ({
      instanceId: instance.instanceId, kind: kindOf(instance), name: instance.displayName || (kindOf(instance) === "claude" ? "Claude" : "ChatGPT"),
      signedIn: instance.snapshot?.authenticated === true,
    }));
  }

  const signInView = (flow) => ({ flowId: flow.flowId, phase: flow.phase, authorizationUrl: flow.authorizationUrl ?? null, ...(flow.userCode ? { userCode: flow.userCode } : {}), needsCode: flow.needsCode === true, ...(flow.message ? { message: flow.message } : {}) });

  async function signIn(instanceId) {
    const link = needLink();
    const proxy = await signedIn(link);
    const all = await readEngines(link);
    const engine = all.find((entry) => entry.instanceId === instanceId);
    if (!engine) throw new Error("That AI is not on your server.");
    if (engine.kind === "codex") {
      const auth = await deps.localCredentials.codexAuth().catch(() => null);
      if (auth) {
        await proxy.control("codex-auth", { auth });
        return signInView({ flowId: null, phase: "succeeded" });
      }
    }
    if (engine.kind === "claude") {
      const cli = await deps.localCredentials.claudeCli().catch(() => null);
      if (cli) {
        const abort = new AbortController();
        const flowId = `local-${randomBytes(9).toString("base64url")}`;
        const flow = { flowId, phase: "waiting", authorizationUrl: null, abort, message: "Finish signing in to Claude in your browser." };
        signIns.set(flowId, flow);
        deps.localCredentials.claudeToken(cli, abort.signal).then(async (token) => {
          if (!CLAUDE_TOKEN.test(token)) throw new Error("Claude did not give this app a sign-in.");
          await proxy.control("claude-token", { token: CLAUDE_TOKEN.exec(token)[0] }, 60_000);
          flow.phase = "succeeded"; flow.message = undefined;
        }).catch(async (error) => {
          if (flow.phase === "cancelled") return;
          log(`vps link: claude setup-token on this mac did not finish (${error?.message ?? error})`);
          // the sign-in on the server instead: a link to open and a code to paste back here
          try {
            const { auth } = await serverCall(link, "POST", `/api/instances/${encodeURIComponent(instanceId)}/auth/start`, {});
            Object.assign(flow, { server: auth.flowId, authorizationUrl: auth.authorizationUrl, needsCode: auth.phase === "waiting", phase: auth.phase === "succeeded" ? "succeeded" : "waiting", message: "Open the link, sign in, then paste the code here." });
          } catch (fallback) {
            flow.phase = "failed"; flow.message = plain(fallback, "Claude could not sign in. Try again.");
          }
        }).finally(() => onChange(view()));
        return signInView(flow);
      }
    }
    // nothing to bring from this mac: the engine's own sign-in, run on the server (a link to open, and a code for claude)
    const { auth } = await serverCall(link, "POST", `/api/instances/${encodeURIComponent(instanceId)}/auth/start`, {});
    return signInView({ ...auth, needsCode: engine.kind === "claude" && auth.phase === "waiting" && !auth.userCode });
  }

  async function signInStatus(instanceId, flowId) {
    const local = signIns.get(flowId);
    if (local && !local.server) return signInView(local);
    const link = needLink();
    if (local) {
      const { auth } = await serverCall(link, "GET", `/api/instances/${encodeURIComponent(instanceId)}/auth/status?flowId=${encodeURIComponent(local.server)}`);
      if (auth.phase !== "waiting") Object.assign(local, { phase: auth.phase, needsCode: false, message: auth.message });
      return signInView(local);
    }
    const { auth } = await serverCall(link, "GET", `/api/instances/${encodeURIComponent(instanceId)}/auth/status?flowId=${encodeURIComponent(flowId)}`);
    return signInView({ ...auth, needsCode: false });
  }
  async function signInCode(instanceId, flowId, code) {
    const serverFlow = signIns.get(flowId)?.server ?? flowId;
    await serverCall(needLink(), "POST", `/api/instances/${encodeURIComponent(instanceId)}/auth/complete`, { flowId: serverFlow, code: String(code).trim().slice(0, 2000) });
    return { ok: true };
  }
  async function signInCancel(instanceId, flowId) {
    const local = signIns.get(flowId);
    if (local) {
      local.phase = "cancelled"; local.abort.abort(); signIns.delete(flowId);
      if (local.server) await serverCall(needLink(), "POST", `/api/instances/${encodeURIComponent(instanceId)}/auth/cancel`, { flowId: local.server }).catch(() => {});
      return { ok: true };
    }
    await serverCall(needLink(), "POST", `/api/instances/${encodeURIComponent(instanceId)}/auth/cancel`, { flowId });
    return { ok: true };
  }

  // ---- what moves, backups, the move ----

  async function local(method, route, body) {
    const response = await localRequest(route, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    const parsed = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(typeof parsed?.error === "string" ? parsed.error : "OpenMausBot on this Mac did not answer."), { status: response.status });
    return parsed;
  }

  async function preview() {
    const [bots, summary, bytes] = await Promise.all([
      local("GET", "/api/bots?messages=0"),
      local("GET", "/api/cloud-send").catch(() => ({ items: [] })),
      deps.dataSize ? deps.dataSize().catch(() => null) : Promise.resolve(null),
    ]);
    const list = Array.isArray(bots?.bots) ? bots.bots : [];
    const items = Array.isArray(summary?.items) ? summary.items : [];
    const count = (kinds) => items.filter((item) => kinds.has(item?.kind)).length;
    return {
      bots: list.map((bot) => ({ id: String(bot.id), name: String(bot.name ?? ""), ...(typeof bot.avatarUrl === "string" ? { avatarUrl: bot.avatarUrl } : {}) })),
      chats: list.reduce((sum, bot) => sum + (Array.isArray(bot.tasks) ? bot.tasks.length : 0), 0),
      messages: null,
      skills: count(SKILL_KINDS),
      memories: null,
      routines: count(ROUTINE_KINDS),
      apps: null,
      bytes,
    };
  }

  /** a full, encrypted backup of this mac's workspace, kept in this app's folder with its own random password */
  async function backupNow(reason = "manual", from = null) {
    const password = randomBytes(24).toString("base64url");
    const call = from ? (method, route, body) => serverCall(from, method, route, body) : local;
    const made = await call("POST", "/api/workspace-backup/export", { password, clientState: {} });
    const response = from
      ? await serverFetch(`${from.origin}/api/workspace-backup/download/${encodeURIComponent(made.id)}`, { credentials: "include", headers: { origin: from.origin }, signal: AbortSignal.timeout(30 * 60_000) })
      : await localRequest(`/api/workspace-backup/download/${encodeURIComponent(made.id)}`, { signal: AbortSignal.timeout(30 * 60_000) });
    if (!response.ok || !response.body) throw new Error("The backup could not be saved.");
    const at = now();
    const saved = await deps.backups.save(`${at}-${made.id}.ombbackup`, response.body);
    if (typeof made.bytes === "number" && saved.bytes !== made.bytes) throw new Error("The backup was cut off while saving. Nothing was changed.");
    const entry = {
      id: made.id, at, bytes: saved.bytes, file: saved.file, reason, passwordP: await protect(password), ...(from ? { from: from.name } : {}),
      summary: made.summary ? { bots: made.summary.bots ?? 0, chats: made.summary.threads ?? 0, messages: made.summary.messages ?? 0, skills: 0, routines: 0 } : null,
    };
    state.backups = [entry, ...state.backups].slice(0, 20);
    write();
    return entry;
  }

  function backups() {
    return state.backups.map(({ id, at, bytes, summary, reason, from }) => ({ id, at, bytes, summary, reason, ...(from ? { from } : {}) }));
  }

  async function restoreFile(entry) {
    const opened = await deps.backups.open(entry.file);
    const upload = await localRequest("/api/workspace-backup/upload", { method: "POST", headers: { "content-type": "application/octet-stream", "content-length": String(opened.size) }, body: opened.body, duplex: "half", signal: AbortSignal.timeout(30 * 60_000) });
    const uploaded = await upload.json().catch(() => ({}));
    if (!upload.ok) throw new Error(typeof uploaded?.error === "string" ? uploaded.error : "The backup could not be read.");
    const staged = await local("POST", "/api/workspace-backup/preview", { id: uploaded.id, password: await unprotect(entry.passwordP) });
    await local("POST", "/api/workspace-backup/restore", { id: staged.id, confirmation: "REPLACE" });
  }

  async function restore(id) {
    const entry = state.backups.find((backup) => backup.id === id);
    if (!entry) throw new Error("That backup is gone.");
    const frozen = await local("GET", "/api/move/freeze").then((got) => got.frozen === true).catch(() => false);
    if (frozen) await local("DELETE", "/api/move/freeze", {}).catch(() => {});
    try { await restoreFile(entry); }
    catch (error) { if (frozen) await local("POST", "/api/move/freeze", {}).catch(() => {}); throw error; }
    deps.ownHomeReset();
    state.move = null;
    write();
    deps.relaunch();
    return { ok: true, restart: true };
  }

  /** a running step keeps an error and its next try only when they are said again with it */
  function moveTo(step, status, extra = {}) {
    state.move = { ...state.move, step, status, ...extra };
    if (!("error" in extra) && status !== "failed") delete state.move.error;
    if (!("retryAt" in extra)) delete state.move.retryAt;
    write();
  }

  async function move() {
    const link = needLink();
    if (state.move && state.move.status === "running") return view();
    await signedIn(link);
    state.move = { linkId: link.id, step: "backup", status: "running", startedAt: now() };
    write();
    try {
      const backup = await backupNow("before-move");
      moveTo("copy", "running", { backupId: backup.id });
      await ownHome.start(link.envId);
    } catch (error) {
      moveTo(state.move.step, "failed", { error: plain(error, "The move could not start. Nothing on this Mac changed.") });
      return view();
    }
    watchMove();
    return view();
  }

  /** the own-home move does the copy, the check and the switch; this follows it and empties this mac only at the end */
  function watchMove() {
    if (moveTimer || closed) return;
    const tick = async () => {
      moveTimer = null;
      const kept = state.move;
      if (!kept || kept.status === "failed" || kept.step === "done") return;
      const seen = ownHome.view();
      try {
        if (!seen || seen.phase === "copy" || seen.phase === "wait") {
          const trouble = ownHome.trouble?.() ?? null;
          const said = trouble?.error ?? seen?.failing?.error;
          const extra = { ...(seen?.chats ? { chats: seen.chats } : {}), ...(seen?.phase === "wait" && seen.waitingFor ? { waitingFor: seen.waitingFor } : {}),
            ...(said ? { error: plain({ message: said }, "Your server didn't answer.") } : {}), ...(trouble ? { retryAt: trouble.retryAt } : {}) };
          if (kept.step !== "copy" || JSON.stringify(extra.chats) !== JSON.stringify(kept.chats) || extra.waitingFor !== kept.waitingFor
            || extra.error !== kept.error || extra.retryAt !== kept.retryAt) moveTo("copy", "running", extra);
        } else if (seen.phase === "finishing") {
          if (kept.step !== "verify") moveTo("verify", "running");
        } else if (seen.phase === "done") {
          if (Array.isArray(seen.left) && seen.left.length) {
            // something did not arrive: this mac keeps everything, as the move left it
            moveTo("done", "done", { kept: true });
            return;
          }
          if (kept.step !== "empty") moveTo("empty", "running");
          const forgot = await local("POST", "/api/move/forget", {}).then(() => true, (error) => { log(`vps link: this mac kept its copy (${error?.message ?? error})`); return false; });
          moveTo("done", "done", forgot ? {} : { kept: true });
          return;
        } else if (seen.phase === "home-again" || seen.phase === "back" || seen.phase === "keeping") {
          moveTo(kept.step, "failed", { error: "The move stopped and your bots stayed on this Mac." });
          return;
        }
      } catch (error) {
        log(`vps link: move check failed (${error?.message ?? error})`);
      }
      moveTimer = setTimeout(() => void tick(), pollMs);
      moveTimer.unref?.();
    };
    moveTimer = setTimeout(() => void tick(), 0);
    moveTimer.unref?.();
  }

  /** the move's next try, now rather than at its time */
  function retryMove() {
    if (!state.move || state.move.status !== "running") return view();
    if (state.move.retryAt) moveTo(state.move.step, "running", {});
    void ownHome.retry?.().catch((error) => log(`vps link: trying the move again failed (${error?.message ?? error})`));
    return view();
  }

  async function moveBack() {
    const link = needLink();
    const proxy = await signedIn(link);
    const fromServer = await backupNow("from-server", link);
    await backupNow("before-restore").catch((error) => log(`vps link: no backup of this mac before moving back (${error?.message ?? error})`));
    // the server stops its bots first, so nothing runs in two places
    await proxy.control("freeze", { place: deps.label() });
    try { await restoreFile(fromServer); }
    catch (error) { await proxy.control("thaw").catch(() => {}); throw new Error(plain(error, "Your bots could not come back. They are still on your server.")); }
    deps.ownHomeReset();
    state.move = null;
    write();
    deps.relaunch();
    return { ok: true };
  }

  async function forget() {
    const link = currentLink();
    if (!link) return view();
    try { await relay.forget(link.id, await unprotect(link.tokenP)); } catch (error) { log(`vps link: the link service did not forget the tunnel (${error?.message ?? error})`); }
    await proxyStarts.get(link.id)?.catch(() => {});
    await proxies.get(link.id)?.close();
    proxies.delete(link.id);
    if (link.envId) deps.forgetServer(link.envId);
    state.links = state.links.filter((entry) => entry.id !== link.id);
    state.current = state.links.at(-1)?.id ?? null;
    if (state.move?.linkId === link.id) state.move = null;
    write();
    return view();
  }

  /** the line that takes OpenMausBot off the server again (link-service/uninstall.sh), from the service it was linked through */
  function uninstallLine() { return `curl -fsSL ${currentLink()?.base ?? base}/uninstall | sh`; }

  function where() {
    if (ownHome.away()) { const home = ownHome.home(); return { place: "vps", server: home ? { id: home.id, name: home.name, origin: home.origin } : null, uninstall: uninstallLine() }; }
    return { place: "mac", server: null };
  }

  /** at launch: every linked server's tunnel opens again, a setup in progress is followed, a move in progress watched */
  async function resume() {
    await Promise.all(state.links.map(async (link) => {
      if (link.mode === "direct" && link.spki && link.origin) deps.pin?.(new URL(link.origin).host, link.spki);
      await proxyFor(link).catch((error) => log(`vps link: ${link.name} tunnel did not open (${error?.message ?? error})`));
    }));
    if (state.pending) follow();
    if (state.move && state.move.status === "running" && state.move.step !== "backup") watchMove();
    if (state.move && state.move.status === "running" && state.move.step === "backup") moveTo("backup", "failed", { error: "The app closed while saving the backup. Nothing on this Mac changed." });
  }

  return {
    view, start, cancel, resume,
    reset() { lastError = null; if (!state.pending && state.move?.step === "done") state.move = null; write(); return view(); },
    engines, signIn, signInStatus, signInCode, signInCancel,
    preview, move, retryMove, moveBack, backups, backupNow: async () => ({ id: (await backupNow("manual")).id }), restore, forget, where,
    open: async () => { const link = needLink(); await deps.switchTo(link.envId); },
    async close() { closed = true; invalidateSetup(); stopFollowing(); clearTimeout(moveTimer); for (const flow of signIns.values()) flow.abort?.abort(); await Promise.allSettled(proxyStarts.values()); await Promise.all([...proxies.values()].map((proxy) => proxy.close())); },
  };
}
