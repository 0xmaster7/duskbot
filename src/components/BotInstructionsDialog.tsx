import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import type { Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { footnoteCls, formBodyCls, formCloseCls, formHeaderCls, formSheetCls, formTitleCls, rowHintCls } from "./ui/GrokDialog";

export function BotInstructionsDialog({ bot, onClose, inline = false }: { bot: Bot; onClose: () => void; inline?: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = useCallback(() => onCloseRef.current(), []);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [close]);

  const content = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div aria-hidden="true" className="ui-dialog-scrim pointer-events-none absolute inset-0" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-instructions-title"
        aria-describedby="bot-instructions-help"
        tabIndex={-1}
        className={cn(formSheetCls, "max-h-[min(640px,calc(100dvh-32px))] max-w-[560px] focus-visible:outline-none!")}
      >
        <header className={formHeaderCls}>
          <h2 id="bot-instructions-title" className={formTitleCls} title={t("botIdentity.dialog.title")}>
            {bot.name}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label={t("botIdentity.dialog.close")}
            className={formCloseCls}
          >
            <X size={16} />
          </button>
        </header>

        <div className={cn(formBodyCls, "pb-3")}>
          {bot.description.trim() ? (
            <div className="whitespace-pre-wrap break-words text-[13px] leading-[18px] tracking-[0.195px] text-ink">
              {bot.description}
            </div>
          ) : (
            <p className={cn(rowHintCls, "m-0 py-5 text-center text-pretty")}>
              {t("botIdentity.dialog.empty")}. {t("botIdentity.dialog.emptyHelp")}
            </p>
          )}
        </div>

        <p id="bot-instructions-help" className={cn(footnoteCls, "shrink-0 px-4 pb-4 pl-4")}>{t("botIdentity.dialog.contextHelp")}</p>
      </div>
    </div>
  );
  return inline ? content : createPortal(content, document.body);
}
