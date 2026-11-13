import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ackCounter, ackRecord, DIRECT_ACK_EVERY, DIRECT_MAGIC, directReader, directRecord, REC_ACK, REC_SEALED } from "./direct-records";
import { sealRaw, utf8 } from "./link-crypto";
import { frameGuard, openFrame, relayNow } from "./relay";

const desktopPath = "../../../electron/vps-link-direct.mjs";
const agentPath = "../../../apps/link-service/agent.mjs";
const desktop = await import(desktopPath);
const agent = await import(agentPath);
const key = randomBytes(32);
const channel = "phoneaaaaa";

/** splits a stream at random points, as a data channel's messages would */
function pieces(bytes: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let at = 0; at < bytes.length;) {
    const size = 1 + Math.floor(Math.random() * 300);
    out.push(bytes.slice(at, at + size));
    at += size;
  }
  return out;
}
const concat = (list: Uint8Array[]) => Buffer.concat(list.map((one) => Buffer.from(one)));

describe("direct records, as the desktop and the agent write them", () => {
  it("writes the same magic and records, byte for byte", () => {
    expect(Buffer.from(DIRECT_MAGIC)).toEqual(desktop.DIRECT_MAGIC);
    expect(Buffer.from(DIRECT_MAGIC)).toEqual(agent.DIRECT_MAGIC);
    expect([REC_SEALED, REC_ACK]).toEqual([desktop.REC_SEALED, desktop.REC_ACK]);
    for (const size of [0, 1, 4, 300, 70_000]) {
      const payload = randomBytes(size);
      expect(Buffer.from(directRecord(REC_SEALED, payload))).toEqual(desktop.directRecord(REC_SEALED, payload));
      expect(Buffer.from(directRecord(REC_SEALED, payload))).toEqual(agent.directRecord(REC_SEALED, payload));
    }
    const count = Buffer.alloc(4);
    count.writeUInt32BE(123_456);
    expect(Buffer.from(ackRecord(123_456))).toEqual(agent.directRecord(agent.REC_ACK, count));
  });

  it("reads the agent's stream in any pieces, after a greeting before the magic", () => {
    const payloads = [randomBytes(10), randomBytes(0), randomBytes(200_000), randomBytes(3)];
    const stream = Buffer.concat([Buffer.from("Welcome to Ubuntu\r\n"), agent.DIRECT_MAGIC, ...payloads.map((one, i) => agent.directRecord(i % 2 ? REC_ACK : REC_SEALED, one))]);
    const seen: Array<[number, Buffer]> = [];
    const read = directReader((type, payload) => seen.push([type, Buffer.from(payload)]));
    for (const piece of pieces(stream)) read(piece);
    expect(seen).toEqual(payloads.map((one, i) => [i % 2 ? REC_ACK : REC_SEALED, one]));
  });

  it("is read by the agent's reader in any pieces", () => {
    const payloads = [randomBytes(5), randomBytes(90_000), randomBytes(1)];
    const stream = concat([DIRECT_MAGIC, ...payloads.map((one) => directRecord(REC_SEALED, one)), ackRecord(40_000)]);
    const seen: Array<[number, Buffer]> = [];
    const read = agent.directReader((type: number, payload: Buffer) => seen.push([type, Buffer.from(payload)]));
    for (const piece of pieces(stream)) read(Buffer.from(piece));
    const ack = Buffer.alloc(4);
    ack.writeUInt32BE(40_000);
    expect(seen).toEqual([...payloads.map((one) => [REC_SEALED, one]), [REC_ACK, ack]]);
  });

  it("refuses what is not a direct link, and a record past the limit", () => {
    expect(() => directReader(() => {})(new Uint8Array(65 * 1024))).toThrow("no direct link here");
    const huge = new Uint8Array(DIRECT_MAGIC.length + 5);
    huge.set(DIRECT_MAGIC);
    new DataView(huge.buffer).setUint32(DIRECT_MAGIC.length, 1024 * 1024 + 1);
    expect(() => directReader(() => {})(huge)).toThrow("malformed record");
    const zero = new Uint8Array(DIRECT_MAGIC.length + 5);
    zero.set(DIRECT_MAGIC);
    expect(() => directReader(() => {})(zero)).toThrow("malformed record");
  });

  it("acks every 32 KB, which the agent's writer counts as delivered", () => {
    const acks = ackCounter();
    expect(acks(DIRECT_ACK_EVERY - 1)).toBeNull();
    const record = acks(1)!;
    const writer = agent.createDirectWriter({ sealFrame: () => Buffer.alloc(29), sealBytes: () => Buffer.alloc(29), write: () => true, inflight: 64 * 1024 });
    writer.bytes("abcdefghijkl", Buffer.alloc(64 * 1024));
    return new Promise<void>((resolve) => setImmediate(() => {
      expect(writer.unacked).toBe(64 * 1024);
      agent.directReader((type: number, payload: Buffer) => { if (type === agent.REC_ACK) writer.acked(payload.readUInt32BE(0)); })(Buffer.concat([agent.DIRECT_MAGIC, Buffer.from(record)]));
      expect(writer.unacked).toBe(64 * 1024 - DIRECT_ACK_EVERY);
      expect(acks(10)).toBeNull();
      resolve();
    }));
  });

  it("seals raw frames the agent opens, and opens the agent's raw frames under one guard with the relay's", async () => {
    const frame = { t: "req", r: "abcdefghijkl", method: "GET", path: "/api/x", end: true };
    const raw = await sealRaw(key, `${channel}|to-vps`, utf8(JSON.stringify({ ...frame, ts: relayNow() })));
    expect(agent.openFrame(key, channel, "to-vps", Buffer.from(raw), agent.frameGuard())).toMatchObject(frame);
    const guard = frameGuard();
    const fromAgent = agent.sealFrame(key, channel, "to-app", { t: "head", r: frame.r, status: 200, headers: {} }, true);
    expect(await openFrame(key, channel, "to-app", new Uint8Array(fromAgent), guard)).toMatchObject({ t: "head", status: 200 });
    // the same sealed frame again, now as the relay would carry it: the shared guard refuses it
    expect(await openFrame(key, channel, "to-app", fromAgent.toString("base64url"), guard)).toBeNull();
    const bytes = randomBytes(40_000);
    const piece = agent.sealBytes(key, channel, "to-app", frame.r, bytes, true);
    const opened = await openFrame(key, channel, "to-app", new Uint8Array(piece), guard);
    expect(opened?.t).toBe("bytes");
    expect(Buffer.from(opened!.b!)).toEqual(bytes);
    await expect(openFrame(key, "phoneaaaab", "to-app", new Uint8Array(agent.sealFrame(key, channel, "to-app", { t: "end", r: frame.r }, true)), guard)).rejects.toThrow();
  });
});
