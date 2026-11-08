// Only the RFB WebSocket crosses the container boundary: container-controlled JavaScript on the app's origin would reach the person's workspace.
import { createHash, randomBytes } from "node:crypto";
import { request, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { isSameOrigin, type RequestAuth } from "../request-auth.ts";
import { isMobileOrigin, mobileBearer } from "../mobile/request.ts";
import { PASS, type RouteHandler } from "./table.ts";
import { joinViewer, openDesktop, writeFrame } from "./rfb-handshake.ts";
import { createUpgrades, type Upgrades } from "./upgrades.ts";

const ROUTE = /^\/api\/desktop-viewer\/(local\/(?:shared|bot-[a-f0-9]{64}|pool-\d+)|vps\/[\w-]+)(\/websockify)?$/;
const HANDSHAKE_MS = 10_000;
const RECHECK_MS = 5_000;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** A desktop that just woke answers its viewer port a moment after the container runs: dial again until it does. */
const REDIAL_MS = 100;
const BOT_ID = /^[\w-]+$/;
const CONTROL_LEASE = /^[A-Za-z0-9_-]{16,120}$/;

/** Providers resolve a managed loopback endpoint, never a browser-supplied URL. */
export interface DesktopConnection {
  port: number;
  password: string | null;
  live?: () => boolean;
  touch?: () => void;
  /** Acquired only by WebSockets; release must not close other viewers. */
  retain?: () => () => void;
}
export interface DesktopTarget {
  key: string;
  resolve: () => Promise<DesktopConnection>;
}

export function desktopViewerUrl(target: string, threadId?: string): string {
  const params = new URLSearchParams({ target, ...(threadId ? { threadId } : {}) });
  return `/desktop-viewer#${params}`;
}

interface Viewer { socket: Socket; close: () => void; owner?: string; botId?: string; valid?: () => boolean }

export function createDesktopViewer(deps: {
  target: (id: string, threadId?: string) => DesktopTarget | undefined;
  live: (auth: RequestAuth) => boolean;
  /** Binds a viewer to a control lease: answers only while `controlLeaseId` holds `botId`'s computer and the target is
   * that computer. Shared and pool targets are refused: a bot hold cannot reserve their desktop. */
  lease?: (id: string, botId: string, controlLeaseId: string, threadId?: string) => (() => boolean) | undefined;
  /** The server's shared upgrade gate; a viewer made without one keeps its own. */
  upgrades?: Upgrades;
}) {
  const upgrades = deps.upgrades ?? createUpgrades();
  const ownGate = deps.upgrades === undefined;
  upgrades.route((path) => Boolean(ROUTE.exec(path)?.[2]));
  const viewers = new Map<IncomingMessage, Viewer>();
  let stopped = false;

  const route: RouteHandler = async ({ req, res, url, path, method, auth, json }) => {
    const match = ROUTE.exec(path);
    if (!match) return PASS;
    res.setHeader("cache-control", "private, no-store");
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    if (!auth.scopes.includes("admin") || (isMobileOrigin(req.headers.origin) ? !mobileBearer(req, auth) : !isSameOrigin(req))) return json(res, 403, { error: "forbidden" });
    // A lease-bound viewer: both names or neither, holding before anything is inspected, rechecked on every liveness pass.
    const botId = url.searchParams.get("botId");
    const controlLeaseId = url.searchParams.get("controlLeaseId");
    const threadId = url.searchParams.get("threadId") ?? undefined;
    if ((botId === null) !== (controlLeaseId === null)) {
      return json(res, 400, { error: "botId and controlLeaseId go together" });
    }
    if ((threadId !== undefined && !BOT_ID.test(threadId)) ||
        (botId !== null && (!BOT_ID.test(botId) || !CONTROL_LEASE.test(controlLeaseId!) || !deps.lease))) {
      return json(res, 400, { error: "botId, threadId or controlLeaseId is not valid" });
    }
    if (botId === null && threadId !== undefined && !match[1].startsWith("vps/")) return json(res, 400, { error: "threadId needs botId and controlLeaseId" });
    // A saved or constructed socket URL must not bypass the join refusal: a bot's lease does not exclude other users of a shared desktop.
    if (botId !== null && (match[1] === "local/shared" || match[1].startsWith("local/pool-"))) {
      return json(res, 409, { error: "Phone control requires a per-bot Local VM. Select per-bot mode in Settings → Computers." });
    }
    const bound = botId === null ? undefined : deps.lease!(match[1], botId, controlLeaseId!, threadId);
    if (botId !== null && !bound) return json(res, 409, { error: "Take control of this computer first" });
    const holds = () => bound?.() ?? true;
    const target = deps.target(match[1], threadId);
    if (!target) return json(res, 404, { error: "Desktop not found" });
    let connection: DesktopConnection;
    const live = () => {
      try { return deps.live(auth) && deps.target(match[1], threadId)?.key === target.key && (connection?.live?.() ?? true); }
      catch { return false; }
    };
    const pending = upgrades.pending(req);
    if (pending && stopped) { pending.socket.destroy(); return; }
    let upgrade: Viewer | undefined;
    if (pending) {
      const viewer: Viewer = { socket: pending.socket, close: () => pending.socket.destroy(), valid: () => live() && holds() };
      if (auth.kind === "session") viewer.owner = auth.session.id;
      if (botId !== null) viewer.botId = botId;
      else if (match[1].startsWith("vps/")) viewer.botId = match[1].slice(4);
      viewers.set(req, viewer);
      pending.socket.once("close", () => viewers.delete(req));
      upgrade = viewer;
    }
    try { connection = await target.resolve(); }
    catch (error) {
      const status = error && typeof error === "object" && "status" in error ? error.status : 502;
      return json(res, typeof status === "number" && status >= 400 && status < 600 ? status : 502,
        { error: "The desktop is not available. Open it again from OpenMausBot." });
    }
    // Inspection may outlive a closed tab or the handshake deadline.
    if (res.destroyed || upgrade?.socket.destroyed) return;
    if (!live()) return json(res, 401, { error: "Viewer access expired" });
    if (!holds()) return json(res, 409, { error: "Take control of this computer first" });
    if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535) {
      return json(res, 409, { error: "The desktop viewer is not available." });
    }
    if (!match[2]) return json(res, 200, { password: connection.password });
    if (!upgrade || !pending) return json(res, 426, { error: "WebSocket upgrade required" });
    const key = req.headers["sec-websocket-key"];
    if (req.headers.upgrade?.toLowerCase() !== "websocket" || req.headers["sec-websocket-version"] !== "13"
      || typeof key !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(key)) {
      return json(res, 400, { error: "Invalid WebSocket handshake" });
    }
    // the viewer may ask the server to answer the desktop's handshake (see rfb-handshake.ts): VPS desktops only
    const serverHandshake = url.searchParams.get("rfb") === "server" && match[1].startsWith("vps/");
    const { socket } = upgrade;
    socket.setNoDelay(true);
    let peer: Duplex | undefined;
    let upstream: ReturnType<typeof request> | undefined;
    let redial: ReturnType<typeof setTimeout> | undefined;
    let recheck: ReturnType<typeof setInterval> | undefined;
    const release = connection.retain?.();
    let closed = false;
    const timeout = setTimeout(() => fail(true), HANDSHAKE_MS);
    timeout.unref();
    upgrade.close = () => {
      if (closed) return;
      closed = true;
      release?.();
      clearTimeout(timeout);
      clearTimeout(redial);
      clearInterval(recheck);
      upstream?.destroy();
      peer?.destroy();
      socket.destroy();
    };
    const fail = (final = false) => {
      if (closed) return;
      if (peer || socket.destroyed) { upgrade.close(); return; }
      upstream?.destroy();
      if (!final && live() && holds()) { redial = setTimeout(dial, REDIAL_MS); return; }
      clearTimeout(redial);
      if (!res.headersSent && !socket.destroyed) json(res, 502, { error: "Could not connect to the desktop viewer" });
    };
    socket.once("close", upgrade.close);
    const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
    const opened = (remote: Duplex, opening?: Buffer[], rest?: { payload: Buffer; raw: Buffer }) => {
      clearTimeout(timeout);
      peer = remote;
      remote.once("error", upgrade.close);
      remote.once("close", upgrade.close);
      pending.release();
      res.detachSocket(socket);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      const head = pending.head;
      pending.head = Buffer.alloc(0);
      if (opening && rest) {
        for (const message of opening) socket.write(writeFrame(message, false));
        joinViewer(socket, head, remote, rest, upgrade.close);
      } else {
        if (head.length) remote.write(head);
        socket.pipe(remote).pipe(socket);
      }
      connection.touch?.();
      recheck = setInterval(() => {
        if (!live() || !holds()) upgrade.close();
        else connection.touch?.();
      }, RECHECK_MS);
      recheck.unref();
    };
    // Fixed host and path, port from an inspected managed container. Never forward cookies, bearer tokens, query parameters or forwarded headers.
    const dial = () => {
      if (closed || socket.destroyed) return;
      const upstreamKey = serverHandshake ? randomBytes(16).toString("base64") : key;
      const next = request({
        hostname: "127.0.0.1", port: connection.port, path: "/websockify",
        headers: { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": upstreamKey, "Sec-WebSocket-Version": "13" },
      });
      upstream = next;
      next.once("error", () => { if (upstream === next) fail(); });
      next.once("response", (answer) => { answer.resume(); if (upstream === next) fail(true); });
      next.once("upgrade", (answer, remote, remoteHead) => {
        const expected = createHash("sha1").update(upstreamKey + WS_GUID).digest("base64");
        if (upstream !== next || !live() || !holds() || socket.destroyed || answer.headers["sec-websocket-accept"] !== expected
          || answer.headers.upgrade?.toLowerCase() !== "websocket") {
          remote.destroy(); fail(true); return;
        }
        if ("setNoDelay" in remote && typeof remote.setNoDelay === "function") remote.setNoDelay(true);
        if (!serverHandshake) {
          opened(remote);
          if (remoteHead.length) socket.write(remoteHead);
          return;
        }
        const lost = () => fail(true);
        remote.once("error", lost);
        openDesktop(remote, remoteHead, connection.password).then(({ opening, rest }) => {
          remote.off("error", lost);
          if (closed || socket.destroyed || !live() || !holds()) { remote.destroy(); fail(true); return; }
          opened(remote, opening, rest);
        }, () => { remote.destroy(); fail(); });
      });
      next.end();
    };
    dial();
  };

  return {
    route,
    attach: upgrades.attach,
    closeForOwner: (owner: string, botId?: string) => {
      let closed = 0;
      for (const viewer of viewers.values()) {
        if (viewer.owner !== owner || (botId !== undefined && viewer.botId !== botId)) continue;
        // A closed viewer stays listed until its socket's close event, which arrives later on Windows.
        if (viewer.socket.destroyed) continue;
        viewer.close();
        closed++;
      }
      return closed;
    },
    recheck: () => {
      let closed = 0;
      for (const viewer of viewers.values()) {
        if (viewer.socket.destroyed) continue;
        let valid = false;
        try { valid = viewer.valid?.() ?? false; } catch { }
        if (valid) continue;
        viewer.close();
        closed++;
      }
      return closed;
    },
    closeAll: () => {
      stopped = true;
      if (ownGate) upgrades.close();
      for (const viewer of viewers.values()) viewer.close();
    },
  };
}
