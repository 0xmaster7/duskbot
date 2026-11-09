// ⌘Q while a bot works: one press only shows the page's pill naming the busy bots, holding the keys or a second quick
// press quits. Quitting from the menu with the mouse, the Dock or the tray never asks. Hold needs the key-up, so it is
// only timed for a press seen through a window's input (before-input-event); a press that only reached the menu can
// still be repeated.

export const HOLD_MS = 1_200;
export const TWICE_MS = 500;

/** ⌘Q on macOS, Ctrl+Q elsewhere, without Shift or Option (⌘⇧Q is the system's Log Out). */
export function isQuitKey(input, platform = process.platform) {
  if (!input || typeof input.key !== "string" || input.key.toLowerCase() !== "q" || input.shift || input.alt) return false;
  return platform === "darwin" ? input.meta === true && !input.control : input.control === true && !input.meta;
}

const isModifierUp = (input, platform) => input.type === "keyUp" && (platform === "darwin" ? input.key === "Meta" : input.key === "Control");

/**
 * @param {{ busy: () => string[], hint: (names: string[]) => void, quit: () => void, platform?: string,
 *   now?: () => number, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} deps
 * `busy`: the names of the bots a quit would stop now. `hint`: show the page's pill with them.
 */
export function createQuitGuard({ busy, hint, quit, platform = process.platform, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let lastPress = -Infinity, hold = null;
  const stopHold = () => { if (hold) { clearTimer(hold); hold = null; } };
  const leave = () => { stopHold(); lastPress = -Infinity; quit(); };

  /** A fresh press. `held`: its key-up will be seen, so holding it can be timed. */
  function press(held) {
    const names = busy();
    if (!names.length) return leave();
    const at = now();
    if (at - lastPress <= TWICE_MS) return leave();
    lastPress = at;
    hint(names);
    stopHold();
    if (held) hold = setTimer(leave, HOLD_MS);
  }

  return {
    press,
    /** The quit item: from the mouse it quits at once, from its accelerator it is a press. */
    menu(triggeredByAccelerator) {
      if (triggeredByAccelerator) press(false);
      else leave();
    },
    /** A window's before-input-event. While a bot works the menu never sees ⌘Q: the guard times it instead. */
    input(event, input) {
      if (!input) return;
      if (isQuitKey(input, platform)) {
        if (input.type === "keyUp") return stopHold();
        if (input.type !== "keyDown" || !busy().length) return;
        event.preventDefault();
        if (!input.isAutoRepeat) press(true);
        return;
      }
      if (isModifierUp(input, platform)) stopHold();
    },
    /** The keys went somewhere else (the window lost focus): a hold that was running is over. */
    release: stopHold,
  };
}
