import { DurableObject } from "cloudflare:workers";

import { createBucket } from "./fair-use.js";
import { createForwarder } from "./forwarder.js";
import { HEARTBEAT_MS } from "./ops.js";
import { CLOSE, MAX_SESSIONS, PAIR_MS, PENDING_BYTES, REPORT_BYTES, REPORT_MIN_BYTES, REPORT_MS, SESSION_ID, bearerOf, forwardCode, json, randomB32, sameHex, sha256hex } from "./protocol.js";

/**
 * one linked server's relay. sockets, all hibernatable:
 * - "ctl": the server's standing socket. the relay sends it {"t":"open","s":<sid>} when an app arrives.
 * - "app:<sid>": one app session; "vps:<sid>": the server's socket for that session.
 * binary messages pass between a session's two sockets untouched (sealed end to end); the text "ping" is answered
 * "pong" by the runtime without waking the object, so idle sockets cost no duration.
 */
export class TunnelRelay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    /** @type {{ id: string, acct: string, verifier: string, at: number } | null | undefined} */
    this.reg = undefined;
    /** app bytes that came before their server's socket: sid -> { parts, size } */
    this.pending = new Map();
    this.unreported = 0;
    this.unreportedOut = 0;
    this.unreportedIn = 0;
    /** incoming websocket messages (billed 20 to a request) and awake time while an app session is open, for the cost estimate */
    this.messages = 0;
    this.awakeMs = 0;
    this.awakeFrom = ctx.getWebSockets("app").length ? Date.now() : null;
    this.reportTimer = null;
    this.forwarder = createForwarder({ bucket: createBucket(), charge: (size, dir) => this.charge(size, dir) });
  }

  async registration() {
    if (this.reg === undefined) this.reg = (await this.ctx.storage.get("reg")) ?? null;
    return this.reg;
  }

  /** binds the tunnel to the account a link grant named, with the verifier of its bearer */
  async register({ id, acct, verifier }) {
    const reg = await this.registration();
    if (reg && reg.acct !== acct) return { ok: false, status: 409, code: "taken" };
    const changed = reg && reg.verifier !== verifier;
    this.reg = { id, acct, verifier, at: Date.now() };
    await this.ctx.storage.put("reg", this.reg);
    if (changed) for (const ws of this.ctx.getWebSockets()) this.closeQuietly(ws, CLOSE.reRegistered, "registered again");
    return { ok: true };
  }

  async forget(token) {
    const reg = await this.registration();
    if (!reg || !sameHex(await sha256hex(token), reg.verifier)) return false;
    for (const ws of this.ctx.getWebSockets()) this.closeQuietly(ws, CLOSE.forgotten, "unlinked");
    await this.ops("drop", { id: reg.id });
    await this.ctx.storage.deleteAll();
    this.reg = null;
    return true;
  }

  /** live counters for the ops page */
  async stats() {
    const reg = await this.registration();
    return { registered: Boolean(reg), server: this.ctx.getWebSockets("ctl").length > 0, sessions: this.ctx.getWebSockets("app").length, ...this.forwarder.stats() };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") return json(426, { error: "websocket only", code: "upgrade" });
    const reg = await this.registration();
    const token = bearerOf(request);
    // an unknown tunnel and a wrong token look the same: the app registers again either way
    if (!reg || !token || !sameHex(await sha256hex(token), reg.verifier)) return json(404, { error: "not found", code: "unknown_tunnel" });
    const role = url.pathname.endsWith("/vps") ? "vps" : "app";
    const sid = url.searchParams.get("s");
    if (role === "vps" && sid === null) return this.acceptCtl(reg);
    if (role === "vps") return this.acceptServerSession(sid);
    return this.acceptApp();
  }

  /** the ops object, best effort: limits protect the relay, they never take it down */
  async ops(method, arg) {
    try { const ops = this.env.OPS; return await ops.get(ops.idFromName("ops"))[method](arg); } catch { return null; }
  }

  async acceptCtl(reg) {
    const admitted = await this.ops("admit", { id: reg.id, acct: reg.acct });
    if (admitted && !admitted.ok) return json(503, { error: admitted.error, code: admitted.code }, { "retry-after": "300" });
    const old = this.ctx.getWebSockets("ctl");
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, ["ctl"]);
    server.serializeAttachment({ role: "ctl", at: Date.now() });
    for (const ws of old) this.closeQuietly(ws, CLOSE.replaced, "replaced");
    await this.arm(Date.now() + HEARTBEAT_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  acceptServerSession(sid) {
    if (!SESSION_ID.test(sid ?? "")) return json(400, { error: "bad session", code: "bad_session" });
    const app = this.ctx.getWebSockets(`app:${sid}`)[0];
    if (!app || this.ctx.getWebSockets(`vps:${sid}`).length) return json(404, { error: "no such session", code: "no_session" });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, ["vps", `vps:${sid}`]);
    server.serializeAttachment({ role: "vps", sid, at: Date.now() });
    const early = this.pending.get(sid);
    this.pending.delete(sid);
    for (const part of early?.parts ?? []) this.forward(app, server, part);
    return new Response(null, { status: 101, webSocket: client });
  }

  acceptApp() {
    const ctl = this.ctx.getWebSockets("ctl")[0];
    if (!ctl) return json(503, { error: "your server is not connected to the relay", code: "server_offline" });
    if (this.ctx.getWebSockets("app").length >= MAX_SESSIONS) return json(429, { error: "too many sessions", code: "sessions" });
    const sid = randomB32(12);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, ["app", `app:${sid}`]);
    server.serializeAttachment({ role: "app", sid, at: Date.now() });
    try { ctl.send(JSON.stringify({ t: "open", s: sid })); } catch { return json(503, { error: "your server is not connected to the relay", code: "server_offline" }); }
    this.awakeFrom ??= Date.now();
    void this.arm(Date.now() + PAIR_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** the alarm at `at` unless one is due sooner */
  async arm(at) {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }

  /** app sessions their server never picked up, and the connected server's check-in with the ops object */
  async alarm() {
    let waiting = false;
    for (const ws of this.ctx.getWebSockets("app")) {
      const { sid, at } = ws.deserializeAttachment() ?? {};
      if (this.ctx.getWebSockets(`vps:${sid}`).length) continue;
      if (Date.now() - at >= PAIR_MS) { this.pending.delete(sid); this.closeQuietly(ws, CLOSE.unpaired, "your server did not answer"); }
      else waiting = true;
    }
    const reg = await this.registration();
    const connected = reg && this.ctx.getWebSockets("ctl").length > 0;
    if (connected) await this.ops("seen", { id: reg.id, acct: reg.acct });
    const next = Math.min(waiting ? Date.now() + PAIR_MS : Infinity, connected ? Date.now() + HEARTBEAT_MS : Infinity);
    if (next !== Infinity) await this.ctx.storage.setAlarm(next);
  }

  peerOf(ws) {
    const a = ws.deserializeAttachment();
    if (!a || a.role === "ctl") return { a, peer: null };
    return { a, peer: this.ctx.getWebSockets(`${a.role === "app" ? "vps" : "app"}:${a.sid}`)[0] ?? null };
  }

  async webSocketMessage(ws, message) {
    this.messages += 1;
    if (typeof message === "string") return;
    const { a, peer } = this.peerOf(ws);
    if (!a || a.role === "ctl") return;
    if (peer) { this.forward(ws, peer, message); return; }
    if (a.role === "vps") { this.closeQuietly(ws, CLOSE.peerGone, "the app left"); return; }
    const early = this.pending.get(a.sid) ?? { parts: [], size: 0 };
    early.parts.push(message);
    early.size += message.byteLength;
    this.pending.set(a.sid, early);
    if (early.size > PENDING_BYTES) { this.pending.delete(a.sid); this.closeQuietly(ws, CLOSE.tooFast, "too much before your server answered"); }
  }

  /** out: toward the app (what the server sends), in: toward the server */
  forward(from, to, data) {
    const dir = from.deserializeAttachment()?.role === "app" ? "in" : "out";
    if (!this.forwarder.forward((bytes) => to.send(bytes), data, data.byteLength, dir)) this.closeQuietly(from, CLOSE.tooFast, "sending faster than the relay allows");
  }

  async webSocketClose(ws, code, reason) {
    this.gone(ws, code, reason);
  }

  async webSocketError(ws) {
    this.gone(ws, 1011, "error");
  }

  gone(ws, code, reason) {
    const { a, peer } = this.peerOf(ws);
    if (a?.role === "app") this.pending.delete(a.sid);
    if (peer) this.closeQuietly(peer, forwardCode(code), String(reason ?? "").slice(0, 100) || "the other side left");
    this.closeQuietly(ws, forwardCode(code), "closed");
    if (a?.role === "app" && this.ctx.getWebSockets("app").every((one) => one === ws)) {
      this.tallyAwake(false);
      if ((this.unreported || this.awakeMs) && !this.reportTimer) void this.report();
    }
    if (a?.role === "ctl" && this.ctx.getWebSockets("ctl").every((one) => one === ws)) void this.registration().then((reg) => reg && this.ops("drop", { id: reg.id }));
  }

  /** awake time so far goes to the tally; `still` keeps counting from now */
  tallyAwake(still) {
    const t = Date.now();
    if (this.awakeFrom !== null) this.awakeMs += t - this.awakeFrom;
    this.awakeFrom = still ? t : null;
  }

  closeQuietly(ws, code, reason) {
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  charge(size, dir) {
    this.unreported += size;
    if (dir === "in") this.unreportedIn += size; else this.unreportedOut += size;
    if (this.reportTimer || this.unreported < REPORT_MIN_BYTES) return;
    this.reportTimer = setTimeout(() => void this.report(), this.unreported >= REPORT_BYTES ? 0 : REPORT_MS);
  }

  /** the account's tally, and the rate this tunnel may use now */
  async report() {
    if (this.awakeFrom !== null) this.tallyAwake(true);
    const bytes = this.unreported, bytesOut = this.unreportedOut, bytesIn = this.unreportedIn, awakeMs = this.awakeMs, messages = this.messages;
    this.unreported = 0; this.unreportedOut = 0; this.unreportedIn = 0; this.awakeMs = 0; this.messages = 0;
    try {
      const reg = await this.registration();
      if (!reg || !(bytes || awakeMs)) return;
      const accounts = this.env.ACCOUNTS;
      const answer = await accounts.get(accounts.idFromName(reg.acct)).report({ acct: reg.acct, tunnel: reg.id, bytes, bytesOut, bytesIn, awakeMs, messages });
      this.forwarder.bucket.set(answer.rate, answer.burst);
    } catch {
      this.unreported += bytes; this.unreportedOut += bytesOut; this.unreportedIn += bytesIn; this.awakeMs += awakeMs; this.messages += messages;
    } finally {
      this.reportTimer = null;
      if (this.unreported >= REPORT_MIN_BYTES) this.charge(0);
    }
  }
}
