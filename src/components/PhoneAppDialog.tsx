import { useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";

import { ANDROID_APK_URL, IOS_APP_STORE_URL, openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { formSheetCls, formTitleCls, mdPrimaryCls, mdSecondaryCls, rowHintCls } from "./ui/GrokDialog";

export const PHONE_APPS: ReadonlyArray<{ id: "ios" | "android"; nameKey: LocaleKey; actionKey: LocaleKey; url: string }> = [
  { id: "ios", nameKey: "phoneApp.ios", actionKey: "phoneApp.iosAction", url: IOS_APP_STORE_URL },
  { id: "android", nameKey: "phoneApp.android", actionKey: "phoneApp.androidAction", url: ANDROID_APK_URL },
];

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
          {t("phoneApp.title")}
        </h2>
        <p className={cn(rowHintCls, "m-0 mt-1 text-pretty")}>{t("phoneApp.subtitle")}</p>
        <ul className="m-0 mt-3 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
          {PHONE_APPS.map((app) => (
            <li key={app.id} data-phone-app={app.id} className="flex flex-col items-center gap-2 rounded-[10px] border border-ink/8 p-3 text-center">
              <div className="text-[13px] leading-[18px] text-ink">{t(app.nameKey)}</div>
              <div className="rounded-[6px] bg-white p-1.5">
                <QRCodeSVG value={app.url} size={120} level="M" bgColor="#ffffff" fgColor="#111111" title={t(app.actionKey)} />
              </div>
              <button type="button" onClick={() => void openExternalLink(app.url)} className="rounded-sm text-[12px] leading-4 text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                {t(app.actionKey)}
              </button>
            </li>
          ))}
        </ul>
        {connect.length ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className={cn(rowHintCls, "m-0")}>{t("phoneApp.next")}</p>
            {connect.map((destination, index) => (
              <button
                key={destination.key}
                type="button"
                data-phone-app-connect={destination.key}
                onClick={() => {
                  onClose();
                  destination.onSelect();
                }}
                className={cn(index === 0 ? mdPrimaryCls : mdSecondaryCls, "h-auto min-h-8 w-full flex-col gap-0 rounded-[10px] py-1.5 text-[13px] leading-[18px]")}
              >
                <span>{t("sidebar.menu.connectPhone")}</span>
                <span className="text-[12px] leading-4 opacity-70">{destination.subtitle}</span>
              </button>
            ))}
          </div>
        ) : null}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className={cn(mdSecondaryCls, "mt-3 w-full")}
        >
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}
