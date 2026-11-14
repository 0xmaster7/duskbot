import { rmSync } from "node:fs";
import { join } from "node:path";

/** A source checkout only: a "demo-update" file in userData plays the update pill's whole flow with a pretend release
 * (found, downloading, ready, restart) and removes itself on restart. Nothing is downloaded or installed. */
export function demoUpdateFlag(userData) {
  return join(userData, "demo-update");
}

export function createDemoUpdater({ flag, onState, relaunch, version = "9.9.9", stepMs = 400, timers = globalThis }) {
  let available = null, progress = null, ready = null, ticking = null;
  const state = () => ({ ready, available, progress });
  const tell = () => onState(state());
  return {
    start() { timers.setTimeout(() => { available = version; tell(); }, 3000); },
    state,
    check() {
      if (ready || ticking) return Promise.resolve(version);
      progress = 0; tell();
      ticking = timers.setInterval(() => {
        progress = Math.min(1, progress + 0.1);
        if (progress >= 1) { timers.clearInterval(ticking); ticking = null; progress = null; ready = version; }
        tell();
      }, stepMs);
      return Promise.resolve(version);
    },
    restart() {
      if (!ready) return false;
      try { rmSync(flag, { force: true }); } catch {}
      relaunch();
      return true;
    },
  };
}
