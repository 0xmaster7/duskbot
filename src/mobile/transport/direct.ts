// direct-first for the phone: the phone's own relay channel (relay.ts) stays underneath, and a direct link to the
// server's link agent (a webrtc data channel, direct-rtc.ts) takes every new request while it is up. the direct link
// carries the same sealed frames, sealed with the same channel key and checked by the same replay guard as the relay,
// so nothing about trust changes; only the way there does. the rules are the desktop's (electron/vps-link-protocol.mjs):
// each request keeps the path it started on, a lost direct link sends an unanswered GET or HEAD again over the relay
// and never sends a POST twice, and an event stream left on the relay moves over once direct is up.
import { ackCounter, DIRECT_MAGIC, directReader, directRecord, REC_SEALED } from "./direct-records";
import { peerClass, rtcConnector, type DirectConn, type IceServer } from "./direct-rtc";
import { base64url, sealRaw, unbase64, utf8 } from "./link-crypto";
import { openFrame, relayNow, type FrameGuard, type RelayChannel, type RelayFrame } from "./relay";

export const BACKOFF_MS = [1000, 5000, 15_000, 60_000, 3 * 60_000, 10 * 60_000, 30 * 60_000];
/** a link up this long starts its backoff over when it drops */
const STABLE_MS = 60_000;
/** a server that refused the offer (an older agent, webrtc not installed, direct turned off) is asked again after this */
export const REFUSED_MS = 30 * 60_000;
/** a relay event stream still open this long after the direct link came up moves over (it reconnects by itself) */
export const MOVE_AFTER_MS = 3000;
const HEAD_TIMEOUT_MS = 15_000;
const BODY_PIECE = 128 * 1024;
const RECEIVE_HIGH = 8 * 1024 * 1024;

export type DirectState = "idle" | "connecting" | "up" | "waiting" | "down" | "paused" | "closed";
export type Connect = () => Promise<DirectConn>;

/** a refusal from the server itself, not the network: asking again soon would change nothing */
export class DirectRefusedError extends Error {
  constructor(message: string) { super(message); this.name = "DirectRefusedError"; }
}

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => "abcdefghijklmnopqrstuvwxyz234567"[byte & 31]).join("");

/**
 * one direct link with its hello, pings and reconnects (the phone's port of electron/vps-link-direct.mjs
 * createDirectLink). frames are sealed in the order they were pushed; frames that arrive are opened in parallel and
 * handed on in order.
 */
export function createDirectLink({ channel, key, guard, connect, onFrame, onChange = () => {}, log = () => {}, pingMs = 5000, helloMs = 10_000, connectMs = 20_000, backoff = BACKOFF_MS, now = () => Date.now() }: {
  channel: string; key: Uint8Array; guard: FrameGuard; connect: Connect; onFrame(frame: RelayFrame): void;
  onChange?(change: { state: DirectState; lost?: boolean }): void; log?(line: string): void;
  pingMs?: number; helloMs?: number; connectMs?: number; backoff?: number[]; now?: () => number;
}) {
  let state: DirectState = "idle", conn: DirectConn | null = null, attempt = 0, suspect = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined, pingTimer: ReturnType<typeof setInterval> | undefined, helloTimer: ReturnType<typeof setTimeout> | undefined;
  let rtt: number | null = null, heardAt = 0, upAt = 0, pingSeq = 0, refusedUntil = 0, sending: Promise<void> = Promise.resolve();
  const outstanding = new Map<number, number>();
  const set = (next: DirectState, extra: { lost?: boolean } = {}) => { state = next; onChange({ state, ...extra }); };
  const ready = () => state === "up" && !suspect;
  // read through a call: an await may have moved it on
  const current = (): DirectState => state;

  function retry(ms = backoff[Math.min(attempt, backoff.length - 1)]) {
    if (state === "closed" || state === "paused") return;
    clearTimeout(retryTimer);
    attempt += 1;
    set("waiting");
    retryTimer = setTimeout(() => void dial(), ms);
  }

  function drop(reason: string) {
    if (!conn) return;
    const was = state, gone = conn;
    conn = null;
    clearInterval(pingTimer);
    clearTimeout(helloTimer);
    outstanding.clear();
    suspect = false;
    sending = Promise.resolve();
    gone.close();
    log(`phone link: direct path ${was === "up" ? "lost" : "failed"} (${reason})`);
    set("down", { lost: was === "up" });
    if (was === "up" && now() - upAt >= STABLE_MS) attempt = 0;
    retry();
  }

  function ping(limit = Math.max(4000, (rtt ?? 1000) * 4)) {
    const on = conn;
    if (!on) return;
    const n = (pingSeq += 1);
    outstanding.set(n, now());
    void push({ t: "ping", r: "", n });
    // a busy link answers late but keeps delivering: only silence means it is gone
    const check = () => {
      if (!outstanding.has(n) || conn !== on) return;
      if (now() - heardAt >= limit) drop("no answer");
      else setTimeout(check, limit / 2);
    };
    setTimeout(check, limit);
  }

  /** sealed in order; resolves once its record is handed to the channel */
  function push(frame: RelayFrame): Promise<void> {
    const on = conn;
    if (!on) return Promise.reject(new Error("direct path down"));
    const sealed = sealRaw(key, `${channel}|to-vps`, utf8(JSON.stringify({ ...frame, ts: relayNow() })));
    const next = sending.then(async () => {
      const bytes = await sealed;
      if (conn !== on) throw new Error("direct path down");
      on.send(directRecord(REC_SEALED, bytes));
    });
    sending = next.catch(() => {});
    return next;
  }

  async function dial() {
    if (state === "closed" || state === "paused" || conn || state === "connecting") return;
    clearTimeout(retryTimer);
    if (now() < refusedUntil) { retryTimer = setTimeout(() => void dial(), refusedUntil - now()); set("waiting"); return; }
    set("connecting");
    let link: DirectConn;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const dialing = connect();
    try {
      link = await Promise.race([dialing, new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("no answer in time")), connectMs); })]);
    } catch (error) {
      void dialing.then((late) => late.close(), () => {});
      if (current() !== "connecting") return;
      log(`phone link: direct path did not connect (${error instanceof Error ? error.message : String(error)})`);
      if (error instanceof DirectRefusedError) { refusedUntil = now() + REFUSED_MS; set("waiting"); retryTimer = setTimeout(() => void dial(), REFUSED_MS); return; }
      retry();
      return;
    } finally { clearTimeout(deadline); }
    if (current() !== "connecting") { link.close(); return; }
    conn = link;
    const mine = link;
    const acks = ackCounter();
    let inbound: Promise<void> = Promise.resolve();
    const receive = (frame: RelayFrame) => {
      heardAt = now();
      if (frame.t === "hello") {
        if (state === "up") return;
        clearTimeout(helloTimer);
        upAt = now();
        set("up");
        pingTimer = setInterval(() => ping(), pingMs);
        ping();
        return;
      }
      if (frame.t === "pong") {
        const sent = outstanding.get(frame.n ?? -1);
        if (sent !== undefined) {
          outstanding.delete(frame.n!);
          rtt = rtt === null ? now() - sent : rtt * 0.7 + (now() - sent) * 0.3;
          if (suspect) { suspect = false; set("up"); }
        }
        return;
      }
      if (state !== "up") return;
      if (frame.t === "bytes" && frame.b) {
        const ack = acks(frame.b.length);
        if (ack) mine.send(ack);
      }
      onFrame(frame);
    };
    const read = directReader((type, payload) => {
      if (conn !== mine) return;
      heardAt = now();
      if (type !== REC_SEALED) return; // acks: this end sends small requests and bodies and paces them by the channel's own queue
      const opened = openFrame(key, channel, "to-app", payload, guard);
      opened.catch(() => {});
      inbound = inbound.then(async () => {
        let frame: RelayFrame | null = null;
        try { frame = await opened; } catch { log("phone link: dropped a direct frame that did not open"); }
        if (frame && conn === mine) receive(frame);
      });
    });
    link.onData((chunk) => { try { read(chunk); } catch (error) { if (conn === mine) drop(error instanceof Error ? error.message : "malformed"); } });
    link.onClose((reason) => { if (conn === mine) drop(reason); });
    helloTimer = setTimeout(() => { if (conn === mine) drop("no hello"); }, helloMs);
    link.send(DIRECT_MAGIC);
    void push({ t: "hello", r: "", v: 1 } as RelayFrame).catch(() => {});
  }

  return {
    start() { if (state === "idle") void dial(); },
    ready,
    state: () => state,
    rtt: () => rtt,
    via: () => (conn && state === "up" ? conn.path : null),
    push,
    /** resolves once the channel has room for more of a body */
    room: () => conn?.room() ?? Promise.resolve(),
    /** a network change: new requests take the relay until a quick ping proves this link alive; a link that is down dials now */
    nudge() {
      if (state === "up") { suspect = true; set("up"); ping(Math.max(1500, (rtt ?? 500) * 3)); }
      else if (state === "waiting" || state === "down") { attempt = 0; void dial(); }
    },
    /** the app went to the background: the peer is let go (the system would freeze it anyway) */
    pause() {
      if (state === "closed" || state === "paused") return;
      clearTimeout(retryTimer);
      const was = state;
      state = "paused";
      if (conn) { const gone = conn; conn = null; clearInterval(pingTimer); clearTimeout(helloTimer); outstanding.clear(); suspect = false; gone.close(); }
      onChange({ state, lost: was === "up" });
    },
    /** back in the foreground: dial again at once */
    resume() {
      if (state !== "paused" && state !== "waiting" && state !== "down" && state !== "idle") return;
      if (state === "paused") state = "idle";
      attempt = 0;
      void dial();
    },
    close() {
      if (state === "closed") return;
      clearTimeout(retryTimer);
      const gone = conn;
      conn = null;
      clearInterval(pingTimer);
      clearTimeout(helloTimer);
      const was = state;
      state = "closed";
      gone?.close();
      onChange({ state, lost: was === "up" });
    },
  };
}
export type DirectLink = ReturnType<typeof createDirectLink>;

type Entry = {
  via: "direct" | "relay";
  /** the direct link went away under this request */
  lost(): void;
  frame?(frame: RelayFrame): void;
  /** a relay event stream: ended so it reconnects, now over the direct link */
  move?(): void;
};

type Lifecycle = { onResume?(listener: () => void): () => void; onPause?(listener: () => void): () => void };

export type DirectStats = { direct: number; relay: number; replayed: number };

/**
 * the relay channel with a direct link in front of it. without RTCPeerConnection, or a relay that cannot carry the offer,
 * it is the relay channel as it was.
 */
export function withDirect(relay: RelayChannel, { channel, key, guard, Peer = peerClass(), connect, rtc = {}, tap, lifecycle, log = () => {}, start = true, linkOptions = {} }: {
  channel: string; key: Uint8Array; guard: FrameGuard; Peer?: typeof RTCPeerConnection | null; connect?: Connect;
  /** stun, turn and gathering for the webrtc connector (tests use none) */
  rtc?: { stun?: string[]; turn?: () => Promise<IceServer[]>; gatherMs?: number };
  /** sees each connection the direct link makes (diagnostics and the chaos test) */
  tap?(conn: DirectConn): void;
  lifecycle?: Lifecycle; log?(line: string): void; start?: boolean;
  linkOptions?: Partial<Pick<Parameters<typeof createDirectLink>[0], "pingMs" | "helloMs" | "connectMs" | "backoff">>;
}): RelayChannel & { direct: DirectLink | null; stats: DirectStats } {
  const stats: DirectStats = { direct: 0, relay: 0, replayed: 0 };
  const control = relay.control?.bind(relay);
  if (!control || (!Peer && !connect)) return Object.assign(relay, { direct: null, stats });
  const signal = async (offer: unknown) => {
    const answer = await control("direct-rtc", { offer });
    // an agent from before phones went direct answers "not allowed"; one without webrtc says so
    if (!answer.ok) throw new DirectRefusedError(typeof answer.error === "string" ? answer.error : "refused");
    return answer.data;
  };
  const entries = new Map<string, Entry>();
  let moveTimer: ReturnType<typeof setTimeout> | undefined;
  const link = createDirectLink({
    channel, key, guard, log, ...linkOptions,
    connect: async () => {
      const conn = await (connect ?? rtcConnector({ Peer: Peer!, signal, ...rtc }))();
      tap?.(conn);
      return conn;
    },
    onFrame: (frame) => entries.get(frame.r)?.frame?.(frame),
    onChange: ({ state, lost }) => {
      if (lost) for (const entry of Array.from(entries.values())) if (entry.via === "direct") entry.lost();
      clearTimeout(moveTimer);
      if (state === "up" && link.ready()) moveTimer = setTimeout(() => { if (link.ready()) for (const entry of Array.from(entries.values())) entry.move?.(); }, MOVE_AFTER_MS);
    },
  });

  const viaRelay: RelayChannel["request"] = (method, path, headers = {}, body, signal, onBodyProgress) => {
    stats.relay += 1;
    const accept = new Headers(headers).get("accept") ?? "";
    if (!/text\/event-stream/i.test(accept)) return relay.request(method, path, headers, body, signal, onBodyProgress);
    // an event stream on the relay: once direct is up it is ended, and the event source opens it again over direct
    const r = randomId(), moved = new AbortController();
    entries.set(r, { via: "relay", lost: () => {}, move: () => { entries.delete(r); moved.abort(); } });
    const forget = () => entries.delete(r);
    signal?.addEventListener("abort", forget, { once: true });
    return relay.request(method, path, headers, body, signal ? AbortSignal.any([signal, moved.signal]) : moved.signal, onBodyProgress).then((response) => {
      if (!response.body) { forget(); return response; }
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { forget(); controller.close(); } else controller.enqueue(chunk.value);
          } catch (error) {
            forget();
            // moved, not failed: the stream ends cleanly, as a server that closed it would
            if (moved.signal.aborted && !signal?.aborted) controller.close(); else controller.error(error);
          }
        },
        cancel(reason) { forget(); return reader.cancel(reason); },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }, (error) => { forget(); throw error; });
  };

  const viaDirect: RelayChannel["request"] = (method, path, headers = {}, body, signal, onBodyProgress) => {
    const r = randomId();
    const idempotent = (method === "GET" || method === "HEAD") && !body?.length;
    stats.direct += 1;
    return new Promise<Response>((resolve, reject) => {
      let controller: ReadableStreamDefaultController<Uint8Array>;
      // reached: the request's first frame went into the channel; before that the server cannot have seen it
      let headed = false, finished = false, empty = false, reached = false, got = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => { finished = true; clearTimeout(timer); entries.delete(r); signal?.removeEventListener("abort", onAbort); };
      const fail = (error: unknown) => { if (finished) return; cleanup(); controller.error(error); reject(error); };
      const cancel = (error: unknown) => { fail(error); void link.push({ t: "cancel", r }).catch(() => {}); };
      const onAbort = () => cancel(signal?.reason);
      /** nothing came back and asking again changes nothing (a GET or HEAD, or anything that never left): over the relay */
      const again = (why: unknown) => {
        if (finished) return;
        if (headed || (reached && !idempotent)) { fail(why); return; }
        cleanup();
        controller.error(why);
        stats.direct -= 1;
        stats.replayed += 1;
        log("phone link: a request moved to the relay");
        Promise.resolve().then(() => viaRelay(method, path, headers, body, signal, onBodyProgress)).then(resolve, reject);
      };
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { void link.push({ t: "cancel", r }).catch(() => {}); again(new Error("relay request timed out")); }, HEAD_TIMEOUT_MS);
      };
      const stream = new ReadableStream<Uint8Array>({
        start(value) { controller = value; },
        cancel() { if (!finished) { cleanup(); void link.push({ t: "cancel", r }).catch(() => {}); } },
      }, { highWaterMark: RECEIVE_HIGH, size: (chunk) => chunk.byteLength });
      const data = (bytes: Uint8Array) => {
        if (!headed) { fail(new Error("relay body before headers")); return; }
        got += bytes.length;
        if (empty) return;
        if ((controller.desiredSize ?? 0) < bytes.length) { cancel(new Error("relay response too large")); return; }
        controller.enqueue(bytes);
      };
      entries.set(r, {
        via: "direct",
        lost: () => again(new Error("The connection to your server changed. Try again.")),
        frame(frame) {
          if (finished) return;
          if (frame.t === "head") {
            if (headed) return;
            try {
              empty = method === "HEAD" || [204, 205, 304].includes(frame.status ?? 0);
              const response = new Response(empty ? null : stream, { status: frame.status, headers: frame.headers });
              headed = true;
              clearTimeout(timer);
              resolve(response);
            } catch (error) { fail(error); }
          } else if (frame.t === "bytes" && frame.b) data(frame.b);
          else if (frame.t === "data") data(unbase64(frame.d ?? ""));
          else if (frame.t === "end") {
            if (!headed) { fail(new Error("relay ended before headers")); return; }
            // the agent counts what it sent: a reply that lost bytes on the way fails, never ends short
            if (Number.isSafeInteger(frame.n) && frame.n !== got) { fail(new Error("Part of this reply was lost on the way. Try again.")); return; }
            cleanup();
            controller.close();
          } else if (frame.t === "err") fail(new Error("relay request failed"));
        },
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      arm();
      const send = async () => {
        await link.push({ t: "req", r, method, path, headers: Object.fromEntries(new Headers(headers)), end: !body?.length });
        reached = true;
        if (!body?.length) return;
        onBodyProgress?.(0, body.length);
        for (let at = 0; at < body.length && !finished; at += BODY_PIECE) {
          await link.room();
          if (finished) break;
          await link.push({ t: "body", r, d: base64url(body.subarray(at, at + BODY_PIECE)), end: at + BODY_PIECE >= body.length });
          onBodyProgress?.(Math.min(body.length, at + BODY_PIECE), body.length);
          // a long body still moving is not a stalled request: the wait for an answer counts from its last piece
          if (!headed) arm();
        }
      };
      void send().catch((error) => again(error));
    });
  };

  const unlisten: Array<() => void> = [];
  const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    const nudge = () => link.nudge();
    window.addEventListener("online", nudge);
    window.addEventListener("offline", nudge);
    unlisten.push(() => { window.removeEventListener("online", nudge); window.removeEventListener("offline", nudge); });
    const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
    if (connection && typeof connection.addEventListener === "function") {
      connection.addEventListener("change", nudge);
      unlisten.push(() => connection.removeEventListener("change", nudge));
    }
  }
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    const visibility = () => { if (visible()) link.resume(); else link.pause(); };
    document.addEventListener("visibilitychange", visibility);
    unlisten.push(() => document.removeEventListener("visibilitychange", visibility));
  }
  const stopResume = lifecycle?.onResume?.(() => link.resume());
  const stopPause = lifecycle?.onPause?.(() => link.pause());
  if (stopResume) unlisten.push(stopResume);
  if (stopPause) unlisten.push(stopPause);
  if (start && visible()) link.start();

  return {
    direct: link,
    stats,
    control,
    request(method, path, headers, body, signal, onBodyProgress) {
      return link.ready() ? viaDirect(method, path, headers, body, signal, onBodyProgress) : viaRelay(method, path, headers, body, signal, onBodyProgress);
    },
    close() {
      for (const stop of unlisten.splice(0)) stop();
      clearTimeout(moveTimer);
      link.close();
      relay.close();
    },
  };
}
