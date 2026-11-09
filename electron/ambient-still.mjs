// When the island and the dock hold still: while the person is in another app, the screen is locked or the Mac sleeps,
// or nobody has touched it for a minute. A looping mascot there makes macOS redraw over whatever the person is doing.
// The surfaces still move under the pointer and for a moment after a change (src/ambient/shared.tsx).

export const IDLE_AFTER_S = 60;
/** How often idleness is checked, only while this app is frontmost (anywhere else the surfaces are already still). */
export const CHECK_MS = 5_000;

/**
 * @param {{ app: { on(event: string, fn: () => void): void, removeListener(event: string, fn: () => void): void },
 *   powerMonitor: { on(event: string, fn: () => void): void, removeListener(event: string, fn: () => void): void,
 *     getSystemIdleState(seconds: number): string },
 *   focused: () => boolean, onChange: (still: boolean) => void,
 *   setTimer?: typeof setInterval, clearTimer?: typeof clearInterval, defer?: (fn: () => void) => void }} deps
 * `focused`: whether one of this app's windows has focus.
 */
export function watchStill({ app, powerMonitor, focused, onChange, setTimer = setInterval, clearTimer = clearInterval, defer = setImmediate }) {
  let frontmost = focused(), locked = false, asleep = false, idle = false, still = null, check = null;

  const idleNow = () => { try { return powerMonitor.getSystemIdleState(IDLE_AFTER_S) !== "active"; } catch { return false; } };
  function settle() {
    const watching = frontmost && !locked && !asleep;
    if (watching && !check) { check = setTimer(() => { idle = idleNow(); tell(); }, CHECK_MS); check?.unref?.(); }
    if (!watching && check) { clearTimer(check); check = null; }
    tell();
  }
  function tell() {
    const next = !frontmost || locked || asleep || idle;
    if (next === still) return;
    still = next;
    onChange(still);
  }

  // a blur from one window comes before the focus of the next: look once both have landed
  const refocus = () => defer(() => { frontmost = focused(); if (frontmost) idle = false; settle(); });
  const power = {
    "lock-screen": () => { locked = true; settle(); },
    "unlock-screen": () => { locked = false; idle = false; settle(); },
    suspend: () => { asleep = true; settle(); },
    resume: () => { asleep = false; idle = false; settle(); },
  };
  const appEvents = ["browser-window-focus", "browser-window-blur", "did-become-active", "did-resign-active"];
  for (const event of appEvents) app.on(event, refocus);
  for (const [event, fn] of Object.entries(power)) powerMonitor.on(event, fn);
  settle();

  return {
    still: () => still === true,
    stop() {
      for (const event of appEvents) app.removeListener(event, refocus);
      for (const [event, fn] of Object.entries(power)) powerMonitor.removeListener(event, fn);
      if (check) { clearTimer(check); check = null; }
    },
  };
}
