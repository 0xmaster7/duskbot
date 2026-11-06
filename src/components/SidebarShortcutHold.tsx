import { useSyncExternalStore } from "react";

import { shownBotIds } from "@/lib/sidebar-shortcut-order";

/** grok shows a row's ⌘1…⌘9 once the modifier alone has been held for half a second */
export const SHORTCUT_HOLD_MS = 500;

export const shortcutModifier = (): "Meta" | "Control" =>
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "Meta" : "Control";

export const shortcutBadgeText = (modifier: "Meta" | "Control", n: number) => `${modifier === "Meta" ? "⌘" : "⌃"}${n}`;

type Listener = () => void;

/** The held modifier and, while held, each shown bot's 1-based slot in the order ⌘1…⌘9 opens (App.tsx). */
export function createShortcutHold(modifier: "Meta" | "Control", readOrder: () => string[]) {
  const listeners = new Set<Listener>();
  let slots: Map<string, number> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const set = (next: Map<string, number> | null) => {
    if (slots === next) return;
    slots = next;
    for (const listener of listeners) listener();
  };
  const release = () => {
    clearTimeout(timer);
    timer = undefined;
    set(null);
  };
  const other = (event: KeyboardEvent) => event.altKey || event.shiftKey || (modifier === "Meta" ? event.ctrlKey : event.metaKey);
  const onDown = (event: KeyboardEvent) => {
    if (other(event)) return release();
    if (event.key !== modifier || document.visibilityState === "hidden" || slots || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      set(new Map(readOrder().slice(0, 9).map((id, index) => [id, index + 1])));
    }, SHORTCUT_HOLD_MS);
  };
  const onUp = (event: KeyboardEvent) => {
    if (event.key === modifier || !event.getModifierState(modifier)) release();
  };
  const onVisibility = () => { if (document.visibilityState === "hidden") release(); };
  return {
    subscribe(listener: Listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        window.addEventListener("keydown", onDown, true);
        window.addEventListener("keyup", onUp, true);
        window.addEventListener("blur", release);
        document.addEventListener("visibilitychange", onVisibility);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        window.removeEventListener("keydown", onDown, true);
        window.removeEventListener("keyup", onUp, true);
        window.removeEventListener("blur", release);
        document.removeEventListener("visibilitychange", onVisibility);
        release();
      };
    },
    slot: (botId: string) => slots?.get(botId) ?? null,
  };
}

let shared: ReturnType<typeof createShortcutHold> | null = null;
const hold = () => (shared ??= createShortcutHold(shortcutModifier(), () => shownBotIds(document.querySelector("[data-sidebar-root]"))));

/** This row's ⌘ number while the modifier is held, else null. */
export function useShortcutSlot(botId: string, enabled = true): number | null {
  const store = hold();
  return useSyncExternalStore(
    enabled ? store.subscribe : noSubscribe,
    () => (enabled ? store.slot(botId) : null),
    () => null,
  );
}

const noSubscribe = () => () => {};

/** grok's key cap: 20px tall, 11px, a 4% ink fill and hairline, at the row's right end where its dot sits. */
export function ShortcutBadge({ n }: { n: number }) {
  return (
    <span aria-hidden="true" data-shortcut-badge="" className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
      <span className="flex h-5 min-w-[18px] items-center justify-center rounded-[4px] border border-ink/[0.04] bg-ink/[0.04] px-1 text-[11px] leading-4 tracking-[0.005em] text-ink-secondary">
        {shortcutBadgeText(shortcutModifier(), n)}
      </span>
    </span>
  );
}
