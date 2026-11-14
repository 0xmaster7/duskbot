import type { ProxyOptions } from "vite";

/** The dev renderer's /api proxy to its harness. A harness that dies (a crash, or the dev app's restart on a server
 * change) must end the window's open event stream too: Vite 7.3's proxy keeps the browser's side of an event stream
 * open after its upstream is gone, so the window would show nothing live until its 40 s stale timer. */
export function devApiProxy(port: number | string): ProxyOptions {
  return {
    ws: true,
    target: `http://127.0.0.1:${port}`,
    configure: (proxy) => {
      proxy.on("proxyRes", (upstream, _req, res) => {
        upstream.once("close", () => { if (!res.writableEnded) res.destroy(); });
      });
    },
  };
}
