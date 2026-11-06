import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, X, type LucideIcon } from "lucide-react";
import { openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import { NoticeGlyph, noticeActionCls, type NoticeTone } from "./ui/Notice";

export function NoticeCard({ titleId, icon: Icon, title, onDismiss, dismissLabel = t("notice.dismiss"), notice, children }: {
  titleId: string; icon: LucideIcon; title: string; onDismiss: () => void;
  dismissLabel?: string;
  notice?: string;
  children: ReactNode;
}) {
  return <aside aria-labelledby={titleId} data-notice={notice} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onDismiss(); }
  }} className="fixed bottom-4 left-[calc(var(--rail-beside,0px)_+_1rem)] z-40 max-h-[calc(100dvh-32px)] w-[300px] max-w-[calc(100vw_-_var(--rail-beside,0px)_-_32px)] overflow-y-auto ui-toast p-3 text-[14px] leading-5">
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center text-ink/68"><Icon size={16} /></span>
        <h2 id={titleId} className="m-0 text-[14px] font-medium leading-5 text-ink">{title}</h2>
      </div>
      <button type="button" onClick={onDismiss} aria-label={dismissLabel} className={DISMISS}><X size={14} /></button>
    </div>
    {children}
    <p role="status" className="sr-only">{title}</p>
  </aside>;
}

export const PRIMARY_BUTTON = "ui-button ui-button-primary min-h-9 gap-1.5 px-3 py-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function LinkButton({ url, label, onOpened, className = PRIMARY_BUTTON }: { url: string; label: string; onOpened?: () => void; className?: string }) {
  const [failed, setFailed] = useState(false);
  return <div>
    <button type="button" className={className} onClick={() => {
      setFailed(false);
      void openExternalLink(url).then(onOpened).catch(() => setFailed(true));
    }}>
      {label}<ArrowUpRight size={14} aria-hidden="true" />
    </button>
    {failed && <p role="alert" className="mt-2 text-[12px] text-danger">{t("notice.openFailed")}</p>}
  </div>;
}

export function NotNowButton({ onClick, label = t("notice.notNow") }: { onClick: () => void; label?: string }) {
  return <button type="button" className="py-2 text-[12px] text-ink-secondary hover:text-ink" onClick={onClick}>{label}</button>;
}

const DISMISS = "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink/68 transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";

/** A passing line in the corner, Grok's banner at its smallest: an optional tone glyph, the words, and an optional Undo. */
export function NoticeToast({ text, onDone, tone, action }: { text: string; onDone: () => void; tone?: NoticeTone; action?: { label: string; onClick: () => void } }) {
  useEffect(() => {
    const timer = setTimeout(onDone, action ? 8_000 : 5_000);
    return () => clearTimeout(timer);
  }, [text]);
  return <div role="status" data-notice-toast className="fixed bottom-4 left-[calc(var(--rail-beside,0px)_+_1rem)] z-[60] flex w-[300px] max-w-[calc(100vw_-_var(--rail-beside,0px)_-_32px)] items-start gap-3 ui-toast p-3 text-[14px] leading-5">
    {tone && <NoticeGlyph tone={tone} />}
    <span className="min-w-0 flex-1 break-words">{text}</span>
    {action && <button type="button" className={`${noticeActionCls} -my-[5px]`} onClick={() => { action.onClick(); onDone(); }}>{action.label}</button>}
  </div>;
}
