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
      // a harness that is not listening (starting, or restarting on a server change) never saw the request: Vite would
      // answer 500, which reads as a server error in the trail, so the window gets the same dropped connection it would
      // get from a packaged app whose server is down
      proxy.on("error", (error, _req, res) => {
        const code = (error as NodeJS.ErrnoException).code;
        if ("req" in res && !res.headersSent && (code === "ECONNREFUSED" || code === "ECONNRESET")) res.destroy();
      });
    },
  };
}
