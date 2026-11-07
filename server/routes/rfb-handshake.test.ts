import { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import { joinViewer, openDesktop, readFrame, writeFrame } from "./rfb-handshake.ts";
import { vncAuthResponse } from "./vnc-des.ts";

/** Two connected ends: what one writes, the other reads. */
function pair(): [Duplex, Duplex] {
  const ends: Duplex[] = [];
  for (let i = 0; i < 2; i++) {
    ends.push(new Duplex({
      read() {},
      write(chunk, _encoding, done) { ends[1 - i]!.push(chunk); done(); },
    }));
  }
  return [ends[0]!, ends[1]!];
}

/** Collects the payloads of the frames arriving at `end`. */
function frames(end: Duplex) {
  let raw = Buffer.alloc(0);
  const seen: Array<{ opcode: number; payload: Buffer }> = [];
  const waiters: Array<() => void> = [];
  end.on("data", (chunk: Buffer) => {
    raw = Buffer.concat([raw, chunk]);
    for (let next; (next = readFrame(raw));) { raw = raw.subarray(next.size); seen.push(next.frame); }
    waiters.splice(0).forEach((wake) => wake());
  });
  return {
    seen,
    async next(): Promise<Buffer> {
      while (!seen.length) await new Promise<void>((resolve) => waiters.push(resolve));
      return seen.shift()!.payload;
    },
  };
}

const serverInit = Buffer.concat([Buffer.from([5, 0, 3, 32, 32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]), Buffer.from([0, 0, 0, 3]), Buffer.from("bot")]);

describe("the server's half of the desktop handshake", () => {
  it("answers VNC authentication with the classic DES of the challenge", () => {
    const challenge = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
    expect(vncAuthResponse("fixture1", challenge).toString("hex")).toBe("3c7e3e26c21794ad9247cffccf875317");
    expect(vncAuthResponse("pw", challenge).toString("hex")).toBe("858600d9af143c9e6541d3dd92a835d0");
    // only the first eight characters count, as vncpasswd stores them
    expect(vncAuthResponse("fixture1-and-more", challenge)).toEqual(vncAuthResponse("fixture1", challenge));
  });

  it("finishes the handshake with the desktop and hands the viewer the opening as two messages", async () => {
    const [ours, desktop] = pair();
    const heard = frames(desktop);
    const opened = openDesktop(ours, Buffer.alloc(0), "fixture1");
    const challenge = Buffer.alloc(16, 7);
    desktop.write(writeFrame(Buffer.from("RFB 003.008\n"), false));
    expect((await heard.next()).toString()).toBe("RFB 003.008\n");
    desktop.write(writeFrame(Buffer.from([2, 1, 2]), false));
    expect([...await heard.next()]).toEqual([2]);
    desktop.write(writeFrame(challenge, false));
    expect(await heard.next()).toEqual(vncAuthResponse("fixture1", challenge));
    desktop.write(writeFrame(Buffer.from([0, 0, 0, 0]), false));
    expect([...await heard.next()]).toEqual([1]);
    desktop.write(writeFrame(serverInit, false));
    const { opening } = await opened;
    expect(opening.map((message) => message.toString("latin1"))).toEqual([
      "RFB 003.008\n",
      Buffer.concat([Buffer.from([1, 1, 0, 0, 0, 0]), serverInit]).toString("latin1"),
    ]);
  });

  it("fails when the desktop refuses the password", async () => {
    const [ours, desktop] = pair();
    const opened = openDesktop(ours, Buffer.alloc(0), "wrong");
    desktop.write(writeFrame(Buffer.concat([Buffer.from("RFB 003.008\n")]), false));
    desktop.write(writeFrame(Buffer.from([1, 2]), false));
    desktop.write(writeFrame(Buffer.alloc(16), false));
    desktop.write(writeFrame(Buffer.from([0, 0, 0, 1]), false));
    await expect(opened).rejects.toThrow(/refused/);
  });

  it("drops the viewer's own opening, then passes everything both ways untouched", async () => {
    const [viewerSide, viewer] = pair();
    const [upstreamSide, desktop] = pair();
    const atDesktop = frames(desktop);
    const atViewer = frames(viewer);
    let failed = false;
    joinViewer(viewerSide, Buffer.alloc(0), upstreamSide, { payload: Buffer.alloc(0), raw: Buffer.alloc(0) }, () => { failed = true; });
    viewer.write(writeFrame(Buffer.from("RFB 003.008\n"), true));
    viewer.write(writeFrame(Buffer.from([1]), true));
    // ClientInit and the first real message in one frame: only the message goes on
    viewer.write(writeFrame(Buffer.from([1, 3, 0, 0, 0, 0, 0, 5, 0, 3, 32]), true));
    viewer.write(writeFrame(Buffer.from([2, 0, 0, 1, 0, 0, 0, 7]), true));
    expect([...await atDesktop.next()]).toEqual([3, 0, 0, 0, 0, 0, 5, 0, 3, 32]);
    expect([...await atDesktop.next()]).toEqual([2, 0, 0, 1, 0, 0, 0, 7]);
    desktop.write(writeFrame(Buffer.from([0, 0, 0, 1]), false));
    expect([...await atViewer.next()]).toEqual([0, 0, 0, 1]);
    expect(failed).toBe(false);
  });
});
