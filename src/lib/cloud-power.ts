// A Cloud home on a plan that sleeps tells its pages it is going to sleep (a `power` frame on the event stream, or an
// "asleep" answer). From then on the page sends nothing in the background: any request reaching the Cloud would wake it.
// The next thing the person does (a key press or a click; never the window regaining focus, which is no intent) wakes it
// again: one POST the home counts as someone using it, which through the public edge also starts a stopped machine.
// On every other Cloud, and on a computer's own server, nothing here ever changes state.

/** Background requests (polls nobody asked for just now) carry this header, so the home doesn't count them as someone
 * using it (server/cloud-power.ts `countsAsActivity`). */
export const BACKGROUND_HEADER = "x-omb-background";
export const CLOUD_POWER_HEADER = "x-omb-cloud-power";
const WAKE_PATH = "/api/cloud/wake";
export type PageWakeIntent = "type" | "click";

type Listener = (asleep: boolean) => void;
const listeners = new Set<Listener>();
let asleep = false, waking = false, sendsHeld = 0;
let detach: (() => void) | null = null;
const wakingListeners = new Set<Listener>();

export function cloudAsleep(): boolean {
  return asleep;
}

export function onCloudPower(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The person acted and the home hasn't answered yet, or a send waits for it to wake: the page says it is waking. */
export function cloudWaking(): boolean {
  return waking || sendsHeld > 0;
}

/** A send is waiting for the Cloud to wake. */
export function cloudSendWaiting(): boolean {
  return sendsHeld > 0;
}

/** Keeps the page saying the Cloud is waking while a send waits for it; the returned function ends this hold. */
export function holdCloudWaking(): () => void {
  sendsHeld++;
  notifyWaking();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    sendsHeld--;
    notifyWaking();
  };
}

function notifyWaking() {
  for (const listener of wakingListeners) listener(cloudWaking());
}

export function onCloudWaking(listener: Listener): () => void {
  wakingListeners.add(listener);
  return () => { wakingListeners.delete(listener); };
}

function setWaking(next: boolean) {
  if (waking === next) return;
  waking = next;
  notifyWaking();
}

function set(next: boolean) {
  if (asleep === next) return;
  asleep = next;
  for (const listener of listeners) listener(next);
}

/** The person is back: wake the Cloud by using it. One request the home counts as someone using it (the event stream
 * reconnecting is not one) also ends a sleep it agreed to but has not carried out, so its held polls stop answering
 * "asleep". */
export function markCloudAwake(intent: PageWakeIntent = "click"): void {
  if (!asleep) return;
  setWaking(true);
  void fetch(WAKE_PATH, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent }) })
    .catch(() => {}).finally(() => setWaking(false));
  detach?.();
  detach = null;
  set(false);
}

/** The home agreed to sleep: stay quiet until the person does something. */
export function markCloudAsleep(target: Pick<Window, "addEventListener" | "removeEventListener"> | undefined = globalThis.window): void {
  if (asleep) return;
  set(true);
  if (!target) return;
  const typed = () => markCloudAwake("type"), clicked = () => markCloudAwake("click");
  const events = [["keydown", typed], ["pointerdown", clicked], ["touchstart", clicked]] as const;
  for (const [name, wake] of events) target.addEventListener(name, wake, { capture: true });
  detach = () => { for (const [name, wake] of events) target.removeEventListener(name, wake, { capture: true }); };
}

/** The page is out of sight: a background tab, a minimized or hidden window. */
export function pageHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** Resolves once the page shows again (at once when it isn't hidden); rejects if `signal` aborts first. */
export function pageShown(signal?: AbortSignal): Promise<void> {
  if (!pageHidden()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { document.removeEventListener("visibilitychange", check); signal?.removeEventListener("abort", abort); };
    const check = () => { if (!pageHidden()) { done(); resolve(); } };
    const abort = () => { done(); reject(signal?.reason ?? new DOMException("The request was aborted.", "AbortError")); };
    if (signal?.aborted) { abort(); return; }
    document.addEventListener("visibilitychange", check);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** The Cloud's edge answers this way while it starts a stopped machine: the request never reached the home. */
export function wakingAnswer(response: Pick<Response, "status" | "headers">): boolean {
  return response.status === 503 && (response.headers.get(CLOUD_POWER_HEADER) === "waking" || response.headers.has("retry-after"));
}

/** An "asleep" answer from the home (held polls and refused background requests carry it). */
export function asleepAnswer(response: Pick<Response, "status" | "headers">): boolean {
  return response.status === 503 && response.headers.get(CLOUD_POWER_HEADER) === "asleep";
}

/** The event stream's frame for it. */
export function sleepingFrame(frame: { kind: string; state?: unknown }): boolean {
  return frame.kind === "power" && frame.state === "sleeping";
}

/** Tests only. */
export function resetCloudPowerForTests(): void {
  detach?.();
  detach = null;
  asleep = false;
  waking = false;
  sendsHeld = 0;
  listeners.clear();
  wakingListeners.clear();
}
