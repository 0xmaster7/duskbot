// The server answers the desktop's VNC handshake itself, then hands the viewer the whole opening at once: a viewer
// across a slow tunnel sees its first picture one round trip after the socket opens instead of five.
import { randomBytes } from "node:crypto";
import type { Duplex } from "node:stream";
import { vncAuthResponse } from "./vnc-des.ts";

const VERSION = Buffer.from("RFB 003.008\n", "latin1");
const NONE = 1;
const VNC_AUTH = 2;
/** What the viewer sends before its first real message: its version, its security choice and ClientInit. */
const VIEWER_OPENING = VERSION.length + 1 + 1;
const MAX_NAME = 4096;

interface Frame { fin: boolean; opcode: number; payload: Buffer }

/** One WebSocket frame from the front of `buffer`, unmasked; null until it is complete. */
export function readFrame(buffer: Buffer): { frame: Frame; size: number } | null {
  if (buffer.length < 2) return null;
  const fin = (buffer[0]! & 0x80) !== 0;
  const opcode = buffer[0]! & 0x0f;
  const masked = (buffer[1]! & 0x80) !== 0;
  let length = buffer[1]! & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const big = buffer.readBigUInt64BE(2);
    if (big > BigInt(16 * 1024 * 1024)) throw new Error("WebSocket frame too large");
    length = Number(big);
    offset = 10;
  }
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i & 3]!;
  return { frame: { fin, opcode, payload }, size: offset + length };
}

/** A binary frame; a client's frames are masked, a server's are not. */
export function writeFrame(payload: Buffer, masked: boolean, opcode = 2): Buffer {
  const length = payload.length;
  const head = length < 126 ? 2 : length < 65536 ? 4 : 10;
  const out = Buffer.alloc(head + (masked ? 4 : 0) + length);
  out[0] = 0x80 | opcode;
  if (length < 126) out[1] = length;
  else if (length < 65536) { out[1] = 126; out.writeUInt16BE(length, 2); }
  else { out[1] = 127; out.writeBigUInt64BE(BigInt(length), 2); }
  if (!masked) { payload.copy(out, head); return out; }
  out[1]! |= 0x80;
  const mask = randomBytes(4);
  mask.copy(out, head);
  for (let i = 0; i < length; i++) out[head + 4 + i] = payload[i]! ^ mask[i & 3]!;
  return out;
}

/** Reads WebSocket frames from one side as a byte stream of their binary payloads. */
function frameStream(socket: Duplex, head: Buffer, onControl: (frame: Frame) => void) {
  let raw = head;
  let bytes = Buffer.alloc(0);
  let wake: (() => void) | null = null;
  let failure: Error | null = null;
  const parse = () => {
    try {
      for (let next; (next = readFrame(raw));) {
        raw = raw.subarray(next.size);
        const { frame } = next;
        if (frame.opcode >= 8) { onControl(frame); continue; }
        if (!frame.fin || frame.opcode === 0) throw new Error("fragmented VNC message");
        bytes = Buffer.concat([bytes, frame.payload]);
      }
    } catch (error) { failure = error instanceof Error ? error : new Error(String(error)); }
    wake?.();
  };
  const data = (chunk: Buffer) => { raw = Buffer.concat([raw, chunk]); parse(); };
  const ended = () => { failure ??= new Error("the desktop closed during its handshake"); wake?.(); };
  socket.on("data", data);
  socket.once("close", ended);
  socket.once("end", ended);
  parse();
  return {
    async take(n: number): Promise<Buffer> {
      while (bytes.length < n) {
        if (failure) throw failure;
        await new Promise<void>((resolve) => { wake = resolve; });
        wake = null;
      }
      const out = bytes.subarray(0, n);
      bytes = bytes.subarray(n);
      return out;
    },
    /** Stops reading: whatever arrived beyond the handshake, as payload and as unparsed frame bytes. */
    detach(): { payload: Buffer; raw: Buffer } {
      socket.pause();
      socket.off("data", data);
      socket.off("close", ended);
      socket.off("end", ended);
      return { payload: bytes, raw };
    },
  };
}

/**
 * Completes the handshake with the desktop's websockify (as its WebSocket client) and returns the opening the viewer
 * gets right after its 101, as two messages: protocol version, None as the only security type, a passed SecurityResult and the
 * desktop's ServerInit. The password never leaves this server.
 */
export async function openDesktop(upstream: Duplex, upstreamHead: Buffer, password: string | null): Promise<{ opening: Buffer[]; rest: { payload: Buffer; raw: Buffer } }> {
  const reader = frameStream(upstream, upstreamHead, (frame) => {
    if (frame.opcode === 9) upstream.write(writeFrame(frame.payload, true, 10));
    else if (frame.opcode === 8) upstream.destroy();
  });
  const send = (bytes: Buffer) => upstream.write(writeFrame(bytes, true));
  try {
    const version = await reader.take(VERSION.length);
    if (!/^RFB 003\.00[78]\n$/.test(version.toString("latin1"))) throw new Error("unsupported VNC version");
    send(VERSION);
    const [count] = await reader.take(1);
    if (!count) throw new Error("the desktop offered no security type");
    const types = [...await reader.take(count)];
    const choice = password !== null && types.includes(VNC_AUTH) ? VNC_AUTH : types.includes(NONE) ? NONE : 0;
    if (!choice) throw new Error("the desktop's security types are not supported");
    send(Buffer.from([choice]));
    if (choice === VNC_AUTH) send(vncAuthResponse(password!, await reader.take(16)));
    if ((await reader.take(4)).readUInt32BE(0) !== 0) throw new Error("the desktop refused its password");
    send(Buffer.from([1]));
    const init = await reader.take(24);
    const nameLength = init.readUInt32BE(20);
    if (nameLength > MAX_NAME) throw new Error("the desktop's name is too long");
    const name = await reader.take(nameLength);
    // two messages: noVNC stops reading after the version and resumes on its next message, so the rest must be one
    const opening = [VERSION, Buffer.concat([Buffer.from([1, NONE, 0, 0, 0, 0]), init, name])];
    return { opening, rest: reader.detach() };
  } catch (error) {
    reader.detach();
    throw error;
  }
}

/**
 * After the opening: drops the viewer's own version, security choice and ClientInit (the desktop already had them),
 * then joins both sides as plain pipes.
 */
export function joinViewer(viewer: Duplex, viewerHead: Buffer, upstream: Duplex, rest: { payload: Buffer; raw: Buffer }, onFail: () => void): void {
  if (rest.payload.length) viewer.write(writeFrame(rest.payload, false));
  if (rest.raw.length) viewer.write(rest.raw);
  upstream.pipe(viewer);
  let raw = viewerHead;
  let skip = VIEWER_OPENING;
  const data = (chunk: Buffer) => { raw = Buffer.concat([raw, chunk]); drain(); };
  const drain = () => {
    try {
      for (let next; skip > 0 && (next = readFrame(raw));) {
        raw = raw.subarray(next.size);
        const { frame } = next;
        if (frame.opcode >= 8) { upstream.write(writeFrame(frame.payload, true, frame.opcode)); continue; }
        if (!frame.fin || frame.opcode === 0) throw new Error("fragmented VNC message");
        const dropped = Math.min(skip, frame.payload.length);
        skip -= dropped;
        if (frame.payload.length > dropped) upstream.write(writeFrame(frame.payload.subarray(dropped), true));
      }
    } catch { onFail(); return; }
    if (skip > 0) return;
    viewer.off("data", data);
    if (raw.length) upstream.write(raw);
    viewer.pipe(upstream);
  };
  viewer.on("data", data);
  drain();
}
