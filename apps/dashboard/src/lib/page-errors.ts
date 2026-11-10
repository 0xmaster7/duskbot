// the page's uncaught errors go to its own service (POST /v1/client-error), which scrubs them and forwards them only
// when the operator configured an error endpoint. at most five per page load.
export function reportPageErrors(target: Pick<Window, "addEventListener"> = window, send: typeof fetch = fetch, path = () => location.pathname) {
  let left = 5;
  const report = (error: unknown) => {
    if (left-- <= 0) return;
    const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "non-error rejection");
    void send("/v1/client-error", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", keepalive: true,
      body: JSON.stringify({ type: err.name, message: err.message, stack: (err.stack ?? "").split("\n").slice(1, 31).join("\n"), page: path().split("/").slice(0, 2).join("/") || "/" }) }).catch(() => {});
  };
  target.addEventListener("error", (event) => report((event as ErrorEvent).error ?? (event as ErrorEvent).message));
  target.addEventListener("unhandledrejection", (event) => report((event as PromiseRejectionEvent).reason));
}
