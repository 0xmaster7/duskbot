import { useEffect, useRef } from "react";

import { useStore, type Bot } from "@/state/store";
import { useBotSettingsDerived } from "./bot-settings/useBotSettingsDerived";
import { BotPanel } from "./bot-panel/PanelShell";
import { BOT_PANEL_ID, sidePanelCls } from "./bot-panel/side-panel";

/** What the panel that just unmounted would have handed focus back to, taken by the next bot's panel when it mounts. */
let focusHandoff: HTMLElement | null = null;

export function BotSettingsDialog({ bot, overlay = false }: {
  bot: Bot;
  overlay?: boolean;
}) {
  const { state, dispatch } = useStore();
  const section = state.botSettingsSection;
  const derived = useBotSettingsDerived(bot);
  const dialogRef = useRef<HTMLElement | null>(null);
  const collapsed = !state.botSettingsExpandAccordion;
  const linkedSection = !collapsed && !state.botSettingsExpandRemembered ? section : null;

  useEffect(() => {
    if (collapsed) return;
    dialogRef.current?.querySelector(`[data-bot-settings-section="${section}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [collapsed, section]);

  useEffect(() => {
    const inherited = focusHandoff;
    focusHandoff = null;
    const previousFocus = inherited ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const dialog = dialogRef.current;
    dialog?.focus();

    const onKey = (event: KeyboardEvent) => {
      const nested = dialog?.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
      if (nested && nested.getClientRects().length > 0) return;
      // a dialog portalled to document.body: a key pressed with focus outside this dialog is not ours
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) return;
      // A popover or field inside that already handled this Escape keeps the panel open.
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        dispatch({ type: "toggleSettings", open: false });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // swapped for the next bot's panel, it hands its return target on; a close returns focus only if it left with the
      // panel, since refocusing a row the person clicked away from scrolls the sidebar back to it
      focusHandoff = previousFocus;
      queueMicrotask(() => {
        if (focusHandoff !== previousFocus) return;
        focusHandoff = null;
        const active = document.activeElement;
        if (!active || active === document.body || dialog?.contains(active)) previousFocus?.focus();
      });
    };
  }, [dispatch]);

  return (
    <aside
      ref={dialogRef}
      id={BOT_PANEL_ID}
      role="dialog"
      aria-labelledby="bot-settings-title"
      tabIndex={-1}
      className={sidePanelCls(overlay)}
    >
      <BotPanel
        bot={bot}
        derived={derived}
        linkedSection={linkedSection}
        computerRequest={state.computerTabRequest}
        onClose={() => dispatch({ type: "toggleSettings", open: false })}
      />
    </aside>
  );
}
