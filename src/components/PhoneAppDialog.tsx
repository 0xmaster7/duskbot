import { t } from "@/lib/i18n";
import { GrokDialog, listCardCls, rowHintCls, rowTitleCls } from "./ui/GrokDialog";

export interface PhoneAppConnect {
  key: string;
  subtitle: string;
  onSelect: () => void;
}

/** Where to connect the phone, when there is more than one place: one row each, as the menu lists them. */
export function PhoneAppDialog({ open, onClose, connect = [] }: { open: boolean; onClose: () => void; connect?: PhoneAppConnect[] }) {
  if (!open) return null;
  return (
    <GrokDialog data-panel-modal="phone" title={t("sidebar.menu.connectPhone")} description={t("settings.phone.pair.hint")} onClose={onClose}>
      {connect.length ? (
        <div className={listCardCls}>
          {connect.map((destination) => (
            <button
              key={destination.key}
              type="button"
              data-phone-app-connect={destination.key}
              onClick={() => {
                onClose();
                destination.onSelect();
              }}
              className="mx-1.5 flex min-h-12 cursor-pointer flex-col items-start justify-center rounded-[10px] px-2 py-2 text-start outline-none transition-[background-color] duration-[120ms] ease-[ease] hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
            >
              <span className={rowTitleCls}>{t("sidebar.menu.connectPhone")}</span>
              <span className={rowHintCls}>{destination.subtitle}</span>
            </button>
          ))}
        </div>
      ) : null}
    </GrokDialog>
  );
}
