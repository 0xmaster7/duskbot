// privacy: a report carries an error's type, message and stack, the page's path, a build label and the os family; the
// service scrubs every field again. never a body, a cookie or anything a person typed outside the message.
const MAX_PER_LOAD = 5;
declare const __APP_VERSION__: string | undefined;
const build = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

function osFamily(agent: string): string {
  if (/iphone|ipad|ios/i.test(agent)) return "ios";
  if (/android/i.test(agent)) return "android";
  if (/mac os|macintosh/i.test(agent)) return "macos";
  if (/windows/i.test(agent)) return "windows";
  if (/linux|cros/i.test(agent)) return "linux";
  return "other";
}

/** uncaught errors and rejections (a React render error with no boundary arrives as one) go to POST /v1/errors */
export function reportPageErrors(target: Pick<Window, "addEventListener"> = window, send: typeof fetch = fetch, path = () => location.pathname,
  agent = () => (typeof navigator === "undefined" ? "" : navigator.userAgent)) {
  let left = MAX_PER_LOAD;
  const seen = new Set<string>();
  const report = (error: unknown) => {
    const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "non-error rejection");
    const stack = (err.stack ?? "").split("\n").slice(1, 31).join("\n");
    const key = `${err.name}|${err.message}|${stack.split("\n")[0] ?? ""}`;
    if (seen.has(key) || left <= 0) return;
    seen.add(key);
    left--;
    const page = path();
    void send("/v1/errors", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", keepalive: true,
      body: JSON.stringify({ source: page.startsWith("/admin") ? "admin" : "web", type: err.name, message: err.message.slice(0, 500), stack: stack.slice(0, 4000),
        path: page.slice(0, 120), version: build, os: osFamily(agent()) }) }).catch(() => {});
  };
  target.addEventListener("error", (event) => report((event as ErrorEvent).error ?? (event as ErrorEvent).message));
  target.addEventListener("unhandledrejection", (event) => report((event as PromiseRejectionEvent).reason));
}
