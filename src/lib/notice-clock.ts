import { seenTimer, type SeenTimer } from "../../shared/seen-clock";
import { track } from "./analytics";
import { flush } from "./product-analytics";

// one corner notice at a time: its visible time from shown to closed, acted on or left. Reported as app actions
// notice_closed and notice_ignored with the notice's id as a word and ms; never anything the notice said.
let open: { notice: string; timer: SeenTimer } | null = null;
let listening = false;

const word = (id: string) => id.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

function end(name: "notice_closed" | "notice_ignored", acted = false): void {
  if (!open) return;
  const { notice, timer } = open;
  open = null;
  const ms = timer.stop();
  if (notice) track(name, acted ? { notice, ms, acted } : { notice, ms });
}

/** the notice on screen now, or null while none is (a notice covered by settings or a dialog pauses, not ends) */
export function noticeOnScreen(id: string | null): void {
  if (!listening && typeof window !== "undefined" && typeof window.addEventListener === "function") {
    listening = true;
    window.addEventListener("pagehide", () => { end("notice_ignored"); void flush(); });
  }
  if (!id) { open?.timer.pause(); return; }
  const notice = word(id);
  if (open?.notice === notice) { open.timer.resume(); return; }
  end("notice_ignored");
  open = { notice, timer: seenTimer() };
}

/** an action on the notice that is tracked on its own: its visible time, for that event's `ms`; the notice then needs no
 * closed event of its own */
export function noticeActed(): number | undefined {
  if (!open) return undefined;
  const ms = open.timer.stop();
  open = null;
  return ms;
}

/** the notice went away by its close or not-now button, or (acted) because its own action went through */
export const noticeClosed = (acted = false): void => end("notice_closed", acted);
