import type { IncomingMessage } from "node:http";
import { expect, it } from "vitest";
import { SOCKET_PIECE } from "../../shared/screen-direct.ts";
import { carriedHeaders, socketFraming } from "./direct-sockets.ts";

/** `ipc` is a gateway's IPC listener: a socket with no address at all */
const req = (headers: Record<string, string>, ipc = false) =>
  ({ headers, socket: ipc ? {} : { remoteAddress: "127.0.0.1", remoteFamily: "IPv4" } }) as unknown as IncomingMessage;

it("carries who is asking and nothing else, and a forwarded request stays forwarded", () => {
  const forwarded = carriedHeaders(req({ cookie: "s=1", host: "h", "x-forwarded-for": "203.0.113.9", "content-length": "9", connection: "keep-alive" }));
  expect(forwarded).toEqual({ cookie: "s=1", host: "h", "x-forwarded-for": "203.0.113.9" });
  // a gateway's IPC peer has no forwarding header: the copy still gets one, so it is never this machine's own request
  expect(carriedHeaders(req({ cookie: "s=1" }, true))["x-forwarded-for"]).toBeTruthy();
  // a request from this machine stays this machine's
  expect(carriedHeaders(req({ cookie: "s=1" }))["x-forwarded-for"]).toBeUndefined();
});

it("keeps WebSocket messages whole across channel pieces, text and binary, and carries a close", () => {
  const sent: Buffer[] = [];
  const out = socketFraming({ sendMessage: (bytes) => { sent.push(bytes); return true; } });
  const big = Buffer.alloc(SOCKET_PIECE * 2 + 5, 7);
  out.send(big, true);
  out.send(Buffer.from("{\"a\":1}"), false);
  out.send(Buffer.alloc(0), true);
  out.close(4404, "tab gone");
  expect(sent.length).toBe(3 + 1 + 1 + 1);
  const into = socketFraming({ sendMessage: () => true });
  const read = sent.map((message) => into.read(message)).filter(Boolean);
  expect(read).toEqual([{ data: big, binary: true }, { data: Buffer.from("{\"a\":1}"), binary: false }, { data: Buffer.alloc(0), binary: true }, { close: { code: 4404, reason: "tab gone" } }]);
  expect(() => into.read(Buffer.from([9, 1]))).toThrow();
});
