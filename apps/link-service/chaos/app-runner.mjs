// the app side of a chaos run: the desktop app's own relay code (createTunnelProxy, following its server across nodes)
// in a process the harness can freeze (a laptop asleep) and drive over ipc
import { createTunnelProxy } from "../../../electron/vps-link-protocol.mjs";

let proxy = null, through = null;
const log = (line) => console.error(`${new Date().toISOString().slice(11, 23)} ${line}`);
const ops = {
  async start(link) {
    proxy = createTunnelProxy({ base: link.base, id: link.id, key: link.key, token: link.token, log, follow: true, hello: { protocol: 2, app: "chaos" }, proxy: () => through });
    return { origin: await proxy.start() };
  },
  nudge() { proxy?.nudge(); return { ok: true }; },
  /** what the system's proxy setting would say for every url: { host, port } or null (DIRECT) */
  useProxy(value) { through = value ?? null; return { ok: true }; },
  node() { return { node: proxy?.node() ?? null }; },
  control({ op, data, timeoutMs }) { return proxy.control(op, data, timeoutMs); },
  async close() { await proxy?.close(); return { ok: true }; },
};
process.on("message", (message) => {
  if (!message || message.chaos || !ops[message.op]) return;
  Promise.resolve().then(() => ops[message.op](message.data)).then(
    (data) => process.send({ seq: message.seq, data }),
    (error) => process.send({ seq: message.seq, error: error?.message ?? String(error) }),
  );
});
