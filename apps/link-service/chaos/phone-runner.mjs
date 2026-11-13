// the phone side of a chaos run: the phone app's own relay transport (src/mobile/transport/relay.ts) on a channel the
// stand-in server handed out, behind a small local http server so the run's probe talks to it like to the desktop's
import { createServer } from "node:http";

const { open } = await import("../../../src/mobile/transport/relay.ts");
let channel = null, server = null;
const ops = {
  async start({ base, id, token, key }) {
    channel = open(base, id, token, Buffer.from(key, "base64url"));
    server = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const abort = new AbortController();
      res.on("close", () => abort.abort());
      try {
        const answer = await channel.request(req.method, req.url, { accept: req.headers.accept ?? "*/*" }, chunks.length ? new Uint8Array(Buffer.concat(chunks)) : null, abort.signal);
        res.writeHead(answer.status, Object.fromEntries(answer.headers));
        if (answer.body) for await (const part of answer.body) res.write(part);
        res.end();
      } catch (error) {
        if (!res.headersSent) { res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ error: String(error?.message ?? error) })); }
        else res.destroy();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { origin: `http://127.0.0.1:${server.address().port}` };
  },
  nudge() { return { ok: true }; },
  useProxy() { return { ok: true }; },
  node() { return { node: null }; },
  async close() { channel?.close(); server?.close(); return { ok: true }; },
};
process.on("message", (message) => {
  if (!message || message.chaos || !ops[message.op]) return;
  Promise.resolve().then(() => ops[message.op](message.data)).then(
    (data) => process.send({ seq: message.seq, data }),
    (error) => process.send({ seq: message.seq, error: error?.message ?? String(error) }),
  );
});
