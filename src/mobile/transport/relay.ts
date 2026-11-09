import { base64url, seal, subtle, unbase64, unseal, utf8 } from "./link-crypto";

export type RelayFrame = {
  t: string;
  r: string;
  ts?: number;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  status?: number;
  end?: boolean;
  d?: string;
  b?: Uint8Array;
  message?: string;
};

type FrameGuard = (iv: string, ts: unknown) => boolean;
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => "abcdefghijklmnopqrstuvwxyz234567"[byte & 31]).join("");
const SKEW_MS = 5 * 60_000;

export function frameGuard(now = Date.now): FrameGuard {
  const seen = new Map<string, number>();
  return (iv, ts) => {
    const time = now();
    if (typeof ts !== "number" || !Number.isFinite(ts) || Math.abs(time - ts) > SKEW_MS || seen.has(iv)) return false;
    seen.set(iv, time);
    for (const [key, at] of seen) { if (time - at <= 2 * SKEW_MS) break; seen.delete(key); }
    return true;
  };
}

export function sealFrame(key: Uint8Array, channel: string, direction: "to-vps" | "to-app", frame: RelayFrame): Promise<string> {
  return seal(key, `${channel}|${direction}`, utf8(JSON.stringify({ ...frame, ts: Date.now() })));
}

export async function openFrame(key: Uint8Array, channel: string, direction: "to-vps" | "to-app", sealed: string, guard: FrameGuard): Promise<RelayFrame | null> {
  const plain = await unseal(key, `${channel}|${direction}`, sealed);
  const frame: RelayFrame = plain[0] === 1 && plain.length >= 21
    ? { t: "bytes", r: new TextDecoder().decode(plain.slice(1, 13)), ts: new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getFloat64(13), b: plain.slice(21) }
    : JSON.parse(new TextDecoder().decode(plain));
  return guard(sealed.slice(0, 16), frame.ts) ? frame : null;
}

export async function readFrameBatches(response: Response, receive: (frames: string[]) => Promise<void>): Promise<void> {
  if (!response.body) throw new Error("missing relay stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const line = async (value: string) => {
    if (!value.trim()) return;
    const batch: unknown = JSON.parse(value);
    if (!batch || typeof batch !== "object" || !("frames" in batch) || !Array.isArray(batch.frames) || !batch.frames.every((frame) => typeof frame === "string")) throw new Error("invalid relay batch");
    await receive(batch.frames);
  };
  try {
    for (;;) {
      const chunk = await reader.read();
      text += decoder.decode(chunk.value, { stream: !chunk.done });
      let at: number;
      while ((at = text.indexOf("\n")) >= 0) { await line(text.slice(0, at)); text = text.slice(at + 1); }
      if (text.length > 24 * 1024 * 1024) throw new Error("relay batch too large");
      if (chunk.done) { await line(text); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export interface RelayChannel {
  request(method: string, path: string, headers?: HeadersInit, body?: Uint8Array | null, signal?: AbortSignal, onBodyProgress?: (sent: number, total: number) => void): Promise<Response>;
  close(): void;
}

export function open(base: string, channel: string, token: string, key: Uint8Array): RelayChannel {
  subtle();
  const root = new URL(base);
  if (!["http:", "https:"].includes(root.protocol) || root.username || root.password || root.pathname !== "/" || root.search || root.hash || !/^[a-z2-7]{10}$/.test(channel) || key.length !== 32) throw new Error("invalid relay route");
  const route = `${root.origin}/v1/channels/${channel}`;
  const postFetch = fetch;
  const streamFetch = typeof window === "undefined" ? fetch : (window as Window & { CapacitorWebFetch?: typeof fetch }).CapacitorWebFetch ?? window.fetch;
  const abort = new AbortController();
  const guard = frameGuard();
  const epoch = randomId();
  let seq = 0, polling = false;
  let posts = Promise.resolve();
  type Pending = { head(frame: RelayFrame): void; data(bytes: Uint8Array): void; end(): void; fail(error: unknown): void };
  const pending = new Map<string, Pending>();
  const close = () => {
    abort.abort();
    for (const request of pending.values()) request.fail(new Error("relay closed"));
    pending.clear();
  };
  const post = (frames: RelayFrame[]) => {
    const next = posts.then(async () => {
      if (abort.signal.aborted) throw new Error("relay closed");
      const sealed = await Promise.all(frames.map((frame) => sealFrame(key, channel, "to-vps", frame)));
      const response = await postFetch(`${route}/to-vps`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ frames: sealed, epoch, seq: seq++ }), credentials: "omit", redirect: "error",
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]),
      });
      await response.text();
      if (!response.ok) throw new Error(`relay post ${response.status}`);
    });
    posts = next.catch(() => { close(); });
    return next;
  };
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      while (!abort.signal.aborted) {
        const response = await streamFetch(`${route}/to-app?wait=25&stream=1`, {
          headers: { Authorization: `Bearer ${token}` }, credentials: "omit", redirect: "error",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(40_000)]),
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error(`relay poll ${response.status}`); }
        await readFrameBatches(response, async (frames) => {
          for (const sealed of frames) {
            let frame: RelayFrame | null;
            try { frame = await openFrame(key, channel, "to-app", sealed, guard); } catch { continue; }
            if (!frame) continue;
            const request = pending.get(frame.r);
            if (!request) continue;
            if (frame.t === "head") request.head(frame);
            else if (frame.t === "data") request.data(unbase64(frame.d ?? ""));
            else if (frame.t === "bytes" && frame.b) request.data(frame.b);
            else if (frame.t === "end") request.end();
            else if (frame.t === "err") request.fail(new Error("relay request failed"));
          }
        });
      }
    } catch { close(); }
  };
  return {
    close,
    request(method, path, headers = {}, body, signal, onBodyProgress) {
      if (abort.signal.aborted || signal?.aborted) return Promise.reject(signal?.reason ?? new Error("relay closed"));
      if (!path.startsWith("/") || path.startsWith("//")) return Promise.reject(new Error("invalid relay path"));
      const r = randomId();
      return new Promise<Response>((resolve, reject) => {
        let controller: ReadableStreamDefaultController<Uint8Array>;
        let headed = false, finished = false, empty = false;
        let timer = setTimeout(() => cancel(new Error("relay request timed out")), 15_000);
        const cleanup = () => { finished = true; clearTimeout(timer); pending.delete(r); signal?.removeEventListener("abort", onAbort); };
        const fail = (error: unknown) => { if (finished) return; cleanup(); controller.error(error); reject(error); };
        const cancel = (error: unknown) => { fail(error); void post([{ t: "cancel", r }]).catch(() => {}); };
        const onAbort = () => cancel(signal?.reason);
        const stream = new ReadableStream<Uint8Array>({
          start(value) { controller = value; },
          cancel() { if (!finished) { cleanup(); void post([{ t: "cancel", r }]).catch(() => {}); } },
        }, { highWaterMark: 8 * 1024 * 1024, size: (chunk) => chunk.byteLength });
        pending.set(r, {
          head(frame) {
            if (headed) return;
            try {
              empty = method === "HEAD" || [204, 205, 304].includes(frame.status ?? 0);
              const response = new Response(empty ? null : stream, { status: frame.status, headers: frame.headers });
              headed = true;
              clearTimeout(timer);
              resolve(response);
            } catch (error) { fail(error); }
          },
          data(bytes) {
            if (!headed) { fail(new Error("relay body before headers")); return; }
            if (!empty) {
              if ((controller.desiredSize ?? 0) < bytes.length) { cancel(new Error("relay response too large")); return; }
              controller.enqueue(bytes);
            }
          },
          end() { if (!headed) { fail(new Error("relay ended before headers")); return; } cleanup(); controller.close(); },
          fail,
        });
        signal?.addEventListener("abort", onAbort, { once: true });
        const send = async () => {
          await post([{ t: "req", r, method, path, headers: Object.fromEntries(new Headers(headers)), end: !body?.length }]);
          if (body?.length) {
            onBodyProgress?.(0, body.length);
            for (let at = 0; at < body.length && pending.has(r); at += 128 * 1024) {
              await post([{ t: "body", r, d: base64url(body.subarray(at, at + 128 * 1024)), end: at + 128 * 1024 >= body.length }]);
              onBodyProgress?.(Math.min(body.length, at + 128 * 1024), body.length);
              if (!pending.has(r)) break;
              // a long body still moving is not a stalled request: the wait for an answer counts from its last chunk
              if (!headed) {
                clearTimeout(timer);
                timer = setTimeout(() => cancel(new Error("relay request timed out")), 15_000);
              }
            }
          }
        };
        void poll();
        void send().catch(fail);
      });
    },
  };
}
