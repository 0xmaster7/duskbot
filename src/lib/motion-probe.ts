// dev builds only: after a send, writes where the transcript's last rows sit on every frame that moved them to the debug
// trail as "dev.motion", for 10s, so a jump seen in the real app can be read frame by frame. Positions and sizes only,
// never text.
import { trail } from "@/lib/trail";

const PROBE_MS = 10_000;
let running = 0;

/** u: the person's bubble, b: a bot bubble, x: any other row (a card, a tool line, a notice) */
const kind = (row: Element): string => !row.querySelector("[data-chat-bubble]") ? "x" : row.classList.contains("items-end") ? "u" : "b";

export function probeMotion(scroller: HTMLElement, column: HTMLElement): void {
  if (!import.meta.env.DEV) return;
  const run = ++running, start = performance.now();
  let prev = "", frame = 0;
  trail("dev.motion", { run, t: 0, note: "start", w: scroller.clientWidth, h: scroller.clientHeight });
  const tick = () => {
    if (run !== running) return;
    const t = Math.round(performance.now() - start);
    const rows = [...column.querySelectorAll("[data-message-row]")].slice(-5)
      .map((row) => { const r = row.getBoundingClientRect(); return `${kind(row)}${Math.round(r.top * 10) / 10}/${Math.round(r.height)}`; }).join(" ");
    const slot = column.parentElement?.querySelector(".turn-status-slot") ?? scroller.querySelector(".turn-status-slot");
    const slotTop = slot ? Math.round(slot.getBoundingClientRect().top * 10) / 10 : -1;
    const glide = getComputedStyle(column).transform;
    const line = `st${Math.round(scroller.scrollTop * 10) / 10} sh${scroller.scrollHeight} slot${slotTop} tf${glide === "none" ? 0 : glide.split(",")[5]?.trim() ?? "?"} | ${rows}`;
    if (line !== prev) trail("dev.motion", { run, t, f: frame, line });
    prev = line; frame++;
    if (t < PROBE_MS) requestAnimationFrame(tick);
    else trail("dev.motion", { run, t, note: "end" });
  };
  requestAnimationFrame(tick);
}
