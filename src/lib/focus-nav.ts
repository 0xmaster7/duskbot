// the focus ring is for someone moving with the keyboard. tab or an arrow key turns it on; a click, a tap or any other
// key (enter opening a dialog, typing) turns it off, so focus a dialog or a click leaves behind draws no ring.
const NAV_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);

export function focusNavKey(key: string): boolean | null {
  if (NAV_KEYS.has(key)) return true;
  if (MODIFIERS.has(key)) return null;
  return false;
}

export function watchFocusNav(root: HTMLElement = document.documentElement): () => void {
  const set = (on: boolean) => { if (on) root.setAttribute("data-focus-nav", ""); else root.removeAttribute("data-focus-nav"); };
  const onKey = (event: KeyboardEvent) => { const nav = focusNavKey(event.key); if (nav !== null) set(nav); };
  const onPointer = () => set(false);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", onPointer, true);
  return () => {
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pointerdown", onPointer, true);
  };
}
