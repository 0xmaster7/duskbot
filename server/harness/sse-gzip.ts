// An event stream to a tunnel listener or a forwarded request (the VPS link agent) crosses a slow network, so it is
// gzipped when the client takes gzip: one zlib context for the whole stream, so a frame reuses the words of the frames
// before it (a live Codex turn's 32 kB of frames went out as 4 kB), and a sync flush after each turn's frames, so they
// leave whole and together the moment they are written (about 30 to 100 µs of zlib). Browsers' EventSource decodes it
// as it arrives. Everything else gets the response itself.
import type { OutgoingHttpHeaders, ServerResponse } from "node:http";
import { constants, createGzip, type Gzip } from "node:zlib";

import { acceptsGzip, isTunnelReply, varyOnEncoding } from "./tunnel-gzip.ts";

/** What an event stream's frames are written to: the response, or the gzip in front of it. */
export type EventStreamOut = ServerResponse | Gzip;

/** Sends the stream's 200 head and returns where its frames go. Ending or destroying the returned stream ends the response. */
export function openEventStream(res: ServerResponse, headers: OutgoingHttpHeaders): EventStreamOut {
  if (!isTunnelReply(res) || !acceptsGzip(res.req.headers["accept-encoding"])) {
    res.writeHead(200, headers);
    return res;
  }
  res.writeHead(200, { ...headers, "content-encoding": "gzip", vary: varyOnEncoding(headers.vary) });
  const zip = createGzip({ flush: constants.Z_SYNC_FLUSH });
  zip.pipe(res);
  zip.on("error", () => res.destroy());
  res.on("close", () => zip.destroy());
  // the frames written in one turn of the event loop go to zlib as one write, so they leave together, as one write
  // would uncompressed (zlib's own flush() between writes stalled events for tens of milliseconds)
  let pending: string[] = [];
  const write = zip.write.bind(zip) as (chunk: string) => boolean;
  const end = zip.end.bind(zip) as () => Gzip;
  const drain = () => {
    if (!pending.length) return;
    const all = pending.join("");
    pending = [];
    if (!zip.destroyed && !zip.writableEnded) write(all);
  };
  return Object.assign(zip, {
    write: (chunk: string) => {
      if (zip.destroyed || zip.writableEnded) return write(chunk);
      if (!pending.length) setImmediate(drain);
      pending.push(chunk);
      return !zip.writableNeedDrain;
    },
    end: () => { drain(); return end(); },
  });
}

