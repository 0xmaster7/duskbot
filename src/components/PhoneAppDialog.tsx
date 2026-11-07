import { useEffect, useRef } from "react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { formSheetCls, formTitleCls, mdSecondaryCls, rowHintCls } from "./ui/GrokDialog";

export interface PhoneAppConnect {
  key: string;
  subtitle: string;
  onSelect: () => void;
}

export function PhoneAppDialog({ open, onClose, connect = [] }: { open: boolean; onClose: () => void; connect?: PhoneAppConnect[] }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div aria-hidden="true" className="ui-dialog-scrim pointer-events-none absolute inset-0" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-app-dialog-title"
        className={cn(formSheetCls, "max-w-[440px] overflow-y-auto px-4 pb-4 pt-3")}
      >
        <h2 id="phone-app-dialog-title" className={cn(formTitleCls, "whitespace-normal")}>
          {t("sidebar.menu.connectPhone")}
        </h2>
        <p className={cn(rowHintCls, "m-0 mt-1 text-pretty")}>{t("settings.phone.pair.hint")}</p>
        {connect.length ? (
          <div className="mt-3 flex flex-col">
            {connect.map((destination) => (
              <button
                key={destination.key}
                type="button"
                data-phone-app-connect={destination.key}
                onClick={() => {
                  onClose();
                  destination.onSelect();
                }}
                className="flex min-h-[32px] w-full cursor-pointer flex-col items-start rounded-lg px-2 py-1.5 text-start hover:bg-ink/[0.035] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
              >
                <span className="text-[13px] leading-[18px] text-ink">{t("sidebar.menu.connectPhone")}</span>
                <span className="text-[12px] leading-4 text-ink-secondary">{destination.subtitle}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-3 flex justify-end">
          <button ref={closeRef} type="button" onClick={onClose} className={mdSecondaryCls}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
