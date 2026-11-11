/** The props each app event may carry. Security: values are names, routes, codes and counts only (no spaces, no free
 * text), so message content, prompts and names people type can never pass through here. */
export const APP_EVENT_PROPS = Object.freeze({
  app_open: ["kind", "platform", "appVersion"],
  app_close: ["ms"],
  app_screen: ["screen"],
  app_feature: ["feature"],
  app_messages: ["sent", "replies", "latencyMs"],
  app_error: ["kind", "code"],
  app_pair_failed: ["reason"],
});
export const MAX_QUEUE = 500;
export const BATCH = 50;
export const FLUSH_MS = 5_000;
export const MAX_BACKOFF_MS = 30 * 60_000;
const REQUEST_MS = 15_000;
const ID = /^[A-Za-z0-9_-]{16,40}$/;
const VALUE = /^[A-Za-z0-9_.:/+-]{1,120}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;

export function cleanAppEvent(input, at = Date.now()) {
  if (!input || typeof input !== "object" || !Object.hasOwn(APP_EVENT_PROPS, input.name)) return null;
  const allowed = APP_EVENT_PROPS[input.name], props = input.props && typeof input.props === "object" ? input.props : {};
  const clean = {};
  for (const [key, value] of Object.entries(props)) {
    if (!allowed.includes(key)) return null;
    if (typeof value === "string" && VALUE.test(value)) clean[key] = value;
    else if (Number.isSafeInteger(value) && value >= 0 && value < 1e12) clean[key] = value;
    else return null;
  }
  const when = Number.isSafeInteger(input.at) && input.at > at - 7 * 86_400_000 && input.at < at + 300_000 ? input.at : at;
  return { name: input.name, at: when, props: clean };
}

/** Posts the desktop renderer's usage events to the account service from main, with this computer's account token when
 * it is signed in and the renderer's install id either way; batches, retries with backoff and keeps at most MAX_QUEUE
 * events while offline. */
export function createProductEvents({ origin, token = () => null, platform, version, fetch: fetcher = globalThis.fetch, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout, random = Math.random }) {
  const endpoint = `${new URL(origin).origin}/v1/app/events`;
  const app = { platform: String(platform), version: VERSION.test(String(version)) ? String(version) : "0.0.0" };
  let queue = [], timer = null, sending = null, failures = 0, closed = false;

  const stop = () => { if (timer !== null) clearTimer(timer); timer = null; };
  function schedule(delay) {
    if (closed || timer !== null || sending || !queue.length) return;
    timer = setTimer(() => { timer = null; void flush(); }, delay);
    timer?.unref?.();
  }
  const backoff = () => Math.min(MAX_BACKOFF_MS, FLUSH_MS * 2 ** Math.min(failures, 20)) * (0.5 + random() / 2);

  async function post(batch) {
    const bearer = token();
    const response = await fetcher(endpoint, {
      method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
      headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify({ install: batch[0].install, ...(batch[0].session ? { session: batch[0].session } : {}), platform: app.platform, version: app.version, events: batch.map(item => item.event) }),
      signal: AbortSignal.timeout(REQUEST_MS),
    });
    await response.body?.cancel().catch(() => {});
    return response.status;
  }
  /** the next batch: the oldest events of one install and session */
  function next() {
    const first = queue[0], batch = [];
    for (const item of queue) {
      if (batch.length === BATCH) break;
      if (item.install === first.install && item.session === first.session) batch.push(item);
    }
    return batch;
  }
  const retryable = status => status === 408 || status === 429 || status >= 500;

  async function flush() {
    stop();
    if (sending) return sending;
    sending = (async () => {
      while (queue.length) {
        const batch = next();
        let status;
        try { status = await post(batch); } catch { status = 0; }
        if (status === 0 || retryable(status)) { failures++; return false; }
        const sent = new Set(batch);
        queue = queue.filter(item => !sent.has(item));
        failures = 0;
      }
      return true;
    })();
    try { return await sending; }
    finally { sending = null; if (!closed) schedule(failures ? backoff() : FLUSH_MS); }
  }

  return {
    /** One renderer batch: `{ install, session?, events }`; anything malformed is dropped, never sent. */
    send(input) {
      if (closed || !input || typeof input !== "object" || !ID.test(input.install) || !Array.isArray(input.events)) return false;
      const session = typeof input.session === "string" && ID.test(input.session) ? input.session : null;
      const at = now();
      for (const raw of input.events.slice(0, MAX_QUEUE)) {
        const event = cleanAppEvent(raw, at);
        if (event) queue.push({ install: input.install, session, event });
      }
      if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
      if (!failures) schedule(queue.length >= BATCH ? 0 : FLUSH_MS);
      else schedule(backoff());
      return true;
    },
    /** The person switched usage analytics off: nothing queued is sent. */
    clear() { queue = []; stop(); failures = 0; },
    flush,
    size: () => queue.length,
    /** One last try at up to four batches, without retries. */
    async close() {
      if (closed) return;
      closed = true;
      stop();
      if (sending) await sending.catch(() => {});
      for (let tries = 0; queue.length && tries < 4; tries++) {
        const batch = next();
        try { await post(batch); } catch {}
        const sent = new Set(batch);
        queue = queue.filter(item => !sent.has(item));
      }
    },
  };
}
