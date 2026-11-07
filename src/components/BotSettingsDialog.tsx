import { useEffect, useRef } from "react";

import { useStore, type Bot } from "@/state/store";
import { useBotSettingsDerived } from "./bot-settings/useBotSettingsDerived";
import { BotPanel } from "./bot-panel/PanelShell";
import { rememberPanelBot } from "./bot-panel/PanelPlaceholder";
import { BOT_PANEL_ID, sidePanelCls } from "./bot-panel/side-panel";

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

  const { id, name, color, mascotBody, mascotFaceColor } = bot;
  useEffect(() => {
    rememberPanelBot({ id, name, color, mascotBody, mascotFaceColor });
  }, [id, name, color, mascotBody, mascotFaceColor]);

  useEffect(() => {
    if (collapsed) return;
    dialogRef.current?.querySelector(`[data-bot-settings-section="${section}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [collapsed, section]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();

    const onKey = (event: KeyboardEvent) => {
      const nested = dialog?.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
      if (nested && nested.getClientRects().length > 0) return;
      // BotInstructionsDialog portals to document.body: a key pressed with focus outside this dialog is not ours.
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
      previousFocus?.focus();
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
        onClose={() => dispatch({ type: "toggleSettings", open: false })}
      />
    </aside>
  );
}
