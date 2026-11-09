// keeps this mac from idle sleep while its linked server uses it: the bots' web traffic leaving through this mac
// (egress), or work they asked of this mac (mac control). the display may still sleep.

/** the system stays up, the display may sleep (electron's powerSaveBlocker type) */
export const LINK_AWAKE_BLOCKER = "prevent-app-suspension";
/** how long after the last use the hold stays, so a bot between two pages does not lose its exit */
export const LINK_AWAKE_LINGER_MS = 3 * 60_000;
const CHECK_MS = 30_000;

/**
 * `blocker` is electron's powerSaveBlocker. never held on battery (as routine wake), nor with `enabled()` false.
 * `touch()` marks a use now; `busy(promise)` holds while the promise runs.
 */
export function createLinkAwake({ blocker, onBattery = () => false, enabled = () => true, lingerMs = LINK_AWAKE_LINGER_MS, checkMs = CHECK_MS, now = Date.now, log = () => {} }) {
  let id = null, lastUse = -Infinity, running = 0, timer = null, closed = false;
  const battery = () => { try { return onBattery() === true; } catch { return false; } };
  const wanted = () => !closed && enabled() && !battery() && (running > 0 || now() - lastUse < lingerMs);

  function evaluate() {
    const hold = wanted();
    if (hold && id === null) {
      id = blocker.start(LINK_AWAKE_BLOCKER);
      log("vps link: keeping this Mac awake while your server uses it");
      timer = setInterval(evaluate, checkMs);
      timer.unref?.();
    } else if (!hold && id !== null) {
      if (blocker.isStarted(id)) blocker.stop(id);
      id = null;
      clearInterval(timer);
      timer = null;
      log(`vps link: this Mac may sleep again (${closed ? "closed" : battery() ? "on battery" : "not in use"})`);
    }
  }

  return {
    touch() {
      lastUse = now();
      if (id === null) evaluate();
    },
    async busy(work) {
      running += 1;
      evaluate();
      try { return await work; }
      finally { running -= 1; lastUse = now(); }
    },
    held: () => id !== null,
    /** a change from outside (power source, the setting) */
    check: evaluate,
    close() { closed = true; evaluate(); },
  };
}
