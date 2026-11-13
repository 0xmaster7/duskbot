// A WebSocket that goes direct when it can (shared/screen-direct.ts, "a WebSocket carried on a direct peer"): the bot
// browser's stream asks the server for a peer first and falls back to the relay socket as before. It behaves like a
// WebSocket for the code that holds it: readyState, binaryType, send, close and the four events.
import { SOCKET_CHANNEL, SOCKET_DIRECT_PATH, SOCKET_DIRECT_TARGET, SOCKET_KIND, SOCKET_PIECE } from "../../shared/screen-direct";
import { directScreenWanted, linkProxyState, linkProxyTurn, onLinkProxy, openDirectScreen } from "./screen-direct";

type Opener = typeof openDirectScreen;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function closeEvent(code: number, reason: string): Event {
  if (typeof CloseEvent === "function") return new CloseEvent("close", { code, reason, wasClean: code === 1000 });
  return Object.assign(new Event("close"), { code, reason, wasClean: code === 1000 });
}

/** Messages in SOCKET_KIND framing; whole WebSocket messages out. */
export function channelFraming() {
  let parts: Uint8Array[] = [];
  return {
    frames(data: string | ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer>[] {
      const text = typeof data === "string";
      const bytes = text ? encoder.encode(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const out: Uint8Array<ArrayBuffer>[] = [];
      for (let at = 0; ; at += SOCKET_PIECE) {
        const last = at + SOCKET_PIECE >= bytes.length;
        const piece = bytes.subarray(at, at + SOCKET_PIECE);
        const frame = new Uint8Array(piece.length + 1);
        frame[0] = text ? (last ? SOCKET_KIND.text : SOCKET_KIND.textPart) : (last ? SOCKET_KIND.binary : SOCKET_KIND.binaryPart);
        frame.set(piece, 1);
        out.push(frame);
        if (last) return out;
      }
    },
    close(code: number, reason: string): Uint8Array<ArrayBuffer> {
      const body = encoder.encode(JSON.stringify({ code, reason }));
      const frame = new Uint8Array(body.length + 1);
      frame[0] = SOCKET_KIND.close;
      frame.set(body, 1);
      return frame;
    },
    read(message: ArrayBuffer): { data: string | ArrayBuffer } | { close: { code: number; reason: string } } | null {
      const bytes = new Uint8Array(message);
      const kind = bytes[0];
      const body = bytes.subarray(1);
      if (kind === SOCKET_KIND.close) {
        try {
          const parsed = JSON.parse(decoder.decode(body)) as { code?: unknown; reason?: unknown };
          return { close: { code: typeof parsed.code === "number" ? parsed.code : 1000, reason: typeof parsed.reason === "string" ? parsed.reason : "" } };
        } catch { return { close: { code: 1000, reason: "" } }; }
      }
      if (kind === SOCKET_KIND.textPart || kind === SOCKET_KIND.binaryPart) { parts.push(body.slice()); return null; }
      if (kind !== SOCKET_KIND.text && kind !== SOCKET_KIND.binary) return null;
      let whole = body;
      if (parts.length) {
        whole = new Uint8Array(parts.reduce((sum, part) => sum + part.length, body.length));
        let at = 0;
        for (const part of [...parts, body]) { whole.set(part, at); at += part.length; }
        parts = [];
      }
      return { data: kind === SOCKET_KIND.text ? decoder.decode(whole) : whole.slice().buffer };
    },
  };
}

class DirectFirstSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 0;
  binaryType: BinaryType = "blob";
  readonly url: string;
  #abort = new AbortController();
  #ws: WebSocket | null = null;
  #channel: RTCDataChannel | null = null;
  #closePeer: (() => void) | null = null;
  #framing = channelFraming();
  #hostname: string;

  constructor(url: string, hostname: string, open: Opener, fallbackSocket: (url: string) => WebSocket) {
    super();
    this.url = url;
    this.#hostname = hostname;
    void this.#start(open, fallbackSocket);
  }

  async #start(open: Opener, fallbackSocket: (url: string) => WebSocket) {
    const target = new URL(this.url);
    let attempt: Awaited<ReturnType<Opener>>;
    try {
      attempt = await open(`${SOCKET_DIRECT_PATH}?${new URLSearchParams({ path: `${target.pathname}${target.search}` })}`, {
        signal: this.#abort.signal, label: SOCKET_CHANNEL, ...(onLinkProxy(this.#hostname) ? { turn: () => linkProxyTurn(), linkDirect: async () => (await linkProxyState()).direct } : {}),
      });
    } catch { return; }
    if (this.readyState !== 0) { if ("channel" in attempt) attempt.close(); return; }
    if ("channel" in attempt) { this.#attach(attempt.channel, attempt.close); return; }
    target.searchParams.set("direct", attempt.fallback);
    this.#relay(fallbackSocket(target.href));
  }

  #attach(channel: RTCDataChannel, closePeer: () => void) {
    this.#channel = channel;
    this.#closePeer = closePeer;
    channel.binaryType = "arraybuffer";
    channel.addEventListener("message", (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const read = this.#framing.read(event.data);
      if (!read) return;
      if ("close" in read) { this.#finish(read.close.code, read.close.reason); return; }
      const data = typeof read.data === "string" || this.binaryType === "arraybuffer" ? read.data : new Blob([read.data]);
      this.dispatchEvent(new MessageEvent("message", { data }));
    });
    channel.addEventListener("close", () => this.#finish(1006, ""));
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  #relay(ws: WebSocket) {
    this.#ws = ws;
    ws.binaryType = this.binaryType;
    ws.addEventListener("open", () => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
    ws.addEventListener("message", (event) => this.dispatchEvent(new MessageEvent("message", { data: event.data })));
    ws.addEventListener("error", () => this.dispatchEvent(new Event("error")));
    ws.addEventListener("close", (event) => this.#finish(event.code, event.reason));
  }

  #finish(code: number, reason: string) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.#closePeer?.();
    this.dispatchEvent(closeEvent(code, reason));
  }

  send(data: string | ArrayBuffer | ArrayBufferView) {
    if (this.readyState !== 1) throw new DOMException("not open", "InvalidStateError");
    if (this.#ws) { this.#ws.send(data as string); return; }
    for (const frame of this.#framing.frames(data)) this.#channel!.send(frame);
  }

  close(code = 1000, reason = "") {
    if (this.readyState >= 2) return;
    if (this.#ws) { this.readyState = 2; this.#ws.close(code, reason); return; }
    this.#abort.abort();
    if (this.#channel?.readyState === "open") this.#channel.send(this.#framing.close(code, reason));
    // the close message goes out before the peer does
    setTimeout(() => this.#closePeer?.(), 100);
    this.#finish(code, reason);
  }

  get bufferedAmount() { return this.#ws?.bufferedAmount ?? this.#channel?.bufferedAmount ?? 0; }
}

/** The bot browser's stream socket: direct first for a server on another machine, the relay socket otherwise. */
export function openStreamSocket(url: string, options: { open?: Opener; socket?: (url: string) => WebSocket; hostname?: string } = {}): WebSocket {
  const make = options.socket ?? ((href: string) => new WebSocket(href));
  const hostname = options.hostname ?? (typeof location === "undefined" ? "" : location.hostname);
  const target = new URL(url, typeof location === "undefined" ? undefined : location.href);
  if (!directScreenWanted(hostname) || !SOCKET_DIRECT_TARGET.test(`${target.pathname}${target.search}`)) return make(url);
  return new DirectFirstSocket(target.href, hostname, options.open ?? openDirectScreen, make) as unknown as WebSocket;
}
