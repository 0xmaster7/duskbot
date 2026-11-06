import { useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";

import { ANDROID_APK_URL, IOS_APP_STORE_URL, openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { formSheetCls, formTitleCls, mdSecondaryCls, rowHintCls, smallButtonCls } from "./ui/GrokDialog";

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
        <ul className="m-0 mt-3 grid list-none grid-cols-2 gap-2 p-0">
          {PHONE_APPS.map((app) => (
            <li key={app.id} data-phone-app={app.id} className="flex flex-col items-center gap-2 py-1 text-center">
              <div className="text-[13px] leading-[18px] text-ink">{t(app.nameKey)}</div>
              <div className="rounded-[8px] bg-white p-1.5 outline outline-[0.5px] -outline-offset-[0.5px] outline-edge">
                <QRCodeSVG value={app.url} size={112} level="M" bgColor="#ffffff" fgColor="#111111" title={t(app.actionKey)} />
              </div>
              <button type="button" onClick={() => void openExternalLink(app.url)} className={smallButtonCls}>
                {t(app.actionKey)}
              </button>
            </li>
          ))}
        </ul>
        {connect.length ? (
          <div className="mt-3 flex flex-col">
            <p className={cn(rowHintCls, "m-0 px-2 pb-1 text-[12px] leading-4")}>{t("phoneApp.next")}</p>
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
