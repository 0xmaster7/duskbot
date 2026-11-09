// The app window's side of electron/desktop-bots.mjs: it tells main which bots are working, so one ⌘Q waits for a
// hold while they do, and shows the pill that press brings up.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Bot } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";

/** The pill stays up this long after the last press. */
export const QUIT_HINT_MS = 2_400;
const NAMED = 3;

export function busyBotNames(bots: readonly Pick<Bot, "name" | "busy" | "hidden" | "movedTo">[]): string[] {
  return bots.filter((bot) => bot.busy && !bot.hidden && !bot.movedTo).map((bot) => bot.name);
}

export function quitHintText(names: readonly string[], mac: boolean, locale = activeLocale()): string {
  const key = mac ? "⌘Q" : "Ctrl+Q";
  if (names.length === 1) return t("ambient.quitHint.one", { name: names[0]!, key });
  if (names.length > NAMED) return t("ambient.quitHint.many", { count: names.length, key });
  let list = names.join(", ");
  try { list = new Intl.ListFormat(locale || undefined, { type: "conjunction" }).format(names); } catch { /* the plain list */ }
  return t("ambient.quitHint.some", { names: list, key });
}

export function DesktopBots({ bots }: { bots: readonly Bot[] }) {
  const bridge = typeof window === "undefined" ? undefined : window.ogb?.desktopBots;
  const busy = busyBotNames(bots).join("\n");
  useEffect(() => { bridge?.busy(busy ? busy.split("\n") : []); }, [bridge, busy]);

  const [hint, setHint] = useState<{ names: string[]; at: number } | null>(null);
  useEffect(() => bridge?.onQuitHint((names) => setHint(names.length ? { names, at: Date.now() } : null)), [bridge]);
  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), QUIT_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [hint]);

  if (!hint || typeof document === "undefined") return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      data-quit-hint=""
      className="pointer-events-none fixed bottom-[88px] left-1/2 z-[70] max-w-[calc(100vw-32px)] -translate-x-1/2 truncate rounded-full bg-menu px-3.5 py-1.5 text-[13px] leading-[18px] text-ink shadow-[var(--shadow-popover)]"
    >
      {quitHintText(hint.names, isMacPlatform())}
    </div>,
    document.body,
  );
}
