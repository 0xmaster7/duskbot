// the direct path's byte stream, as electron/vps-link-direct.mjs and apps/link-service/agent.mjs write it (keep all three
// in step; direct-records.test.ts checks them byte for byte): each end writes DIRECT_MAGIC first, then records of
// [u32 length][type][payload], where length counts the type byte. a sealed record is one frame sealed with the channel
// key; an ack record says how many stream bytes ("bytes" frames) arrived, which is what lets the other end send more.

export const DIRECT_MAGIC = new Uint8Array([0, 0x4f, 0x4d, 0x42, 0x44, 0x31, 0x0a]); // "\0OMBD1\n"
export const REC_SEALED = 1;
export const REC_ACK = 2;
export const DIRECT_MAX_RECORD = 1024 * 1024;
/** stream bytes received between acks; the agent's writer stalls without them */
export const DIRECT_ACK_EVERY = 32 * 1024;

export function directRecord(type: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(5 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length + 1);
  out[4] = type;
  out.set(payload, 5);
  return out;
}

export function ackRecord(count: number): Uint8Array<ArrayBuffer> {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, count);
  return directRecord(REC_ACK, payload);
}

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let at = 0; at + needle.length <= haystack.length; at += 1) {
    for (let i = 0; i < needle.length; i += 1) if (haystack[at + i] !== needle[i]) continue outer;
    return at;
  }
  return -1;
}

/** records out of a byte stream; throws on anything malformed (the caller drops the connection) */
export function directReader(onRecord: (type: number, payload: Uint8Array) => void): (chunk: Uint8Array) => void {
  let buf: Uint8Array = new Uint8Array(0);
  let synced = false;
  return (chunk) => {
    if (buf.length) {
      const joined = new Uint8Array(buf.length + chunk.length);
      joined.set(buf);
      joined.set(chunk, buf.length);
      buf = joined;
    } else buf = chunk;
    if (!synced) {
      const at = indexOf(buf, DIRECT_MAGIC);
      if (at < 0) {
        if (buf.length > 64 * 1024) throw new Error("no direct link here");
        return;
      }
      buf = buf.subarray(at + DIRECT_MAGIC.length);
      synced = true;
    }
    while (buf.length >= 5) {
      const length = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0);
      if (length < 1 || length > DIRECT_MAX_RECORD) throw new Error("malformed record");
      if (buf.length < 4 + length) break;
      const type = buf[4], payload = buf.subarray(5, 4 + length);
      buf = buf.subarray(4 + length);
      onRecord(type, payload);
    }
  };
}

/** counts stream bytes that arrived and hands back an ack record every DIRECT_ACK_EVERY, as the agent's writer expects */
export function ackCounter(): (count: number) => Uint8Array<ArrayBuffer> | null {
  let received = 0;
  return (count) => {
    received += count;
    if (received < DIRECT_ACK_EVERY) return null;
    const record = ackRecord(received);
    received = 0;
    return record;
  };
}
