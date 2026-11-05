import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { GrokIcon, type GrokIconName } from "../../GrokIcon";

/** Grok Bot's kit button: a 32px pill, 14px words at regular weight, a hairline drawn in its own ink. */
export const kitButtonCls = "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-[9999px] px-3 py-1.5 text-[14px] font-normal leading-5 tracking-[0.01em] shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,currentColor_15%,transparent)] outline-none transition-[background-color,color] duration-[120ms] ease-[ease-out] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-default";
export const kitSecondaryCls = cn(kitButtonCls, "bg-ink/6 text-ink enabled:hover:bg-ink/10 disabled:text-ink/30");
export const kitPrimaryCls = cn(kitButtonCls, "bg-ink text-app enabled:hover:bg-[color-mix(in_srgb,var(--color-ink)_88%,var(--color-app))] disabled:bg-ink/15 disabled:text-ink/30");

/** Grok's settings list card: white on a 1px 8% ink outline, 14px corners, 8px above and below its rows. */
export const listCardCls = "flex flex-col rounded-[14px] bg-menu py-2 outline-1 outline-ink/[0.08] [outline-style:solid]";
/** A row in it: 48px tall, 14px in, 13/18 copy. */
export const listRowCls = "flex min-h-12 items-center gap-x-4 px-3.5 py-2.5";
export const rowTitleCls = "text-[13px] leading-[18px] tracking-[-0.08px] text-ink";
export const rowHintCls = "text-[13px] leading-[18px] tracking-[-0.08px] text-ink-secondary";
/** Grok's field: an 8px-cornered hairline box, 13px text, a 56% ink placeholder. */
export const fieldCls = "w-full rounded-[8px] border border-ink/12 bg-transparent px-2.5 py-2 text-[13px] leading-[18px] tracking-[0.195px] text-ink outline-none transition-[border-color] duration-[120ms] ease-[ease] placeholder:text-ink/56 focus:border-ink/30! disabled:opacity-50";

/** A small action in a row, shown on hover, on touch and whenever the row holds focus. */
export function RowIconButton({ icon, label, onClick, disabled, reveal = false, ...rest }: {
  icon: GrokIconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  reveal?: boolean;
  "data-modal-action"?: string;
}) {
  return (
    <button
      type="button"
      {...rest}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-ink/66 transition-[background-color,color,opacity] duration-[120ms] ease-[ease] hover:bg-ink/6 hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus disabled:cursor-default disabled:opacity-30",
        reveal && "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 touch:opacity-100",
      )}
    >
      <GrokIcon name={icon} size={14} />
    </button>
  );
}

/** A labelled group of rows, as Grok's settings panes set them: a 12/16 label 14px in, 8px over its card. */
export function ListGroup({ label, action, children, ...rest }: {
  label?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  "data-modal-group"?: string;
}) {
  return (
    <section {...rest} className="flex flex-col gap-2">
      {label && (
        <div className="flex min-h-4 items-center justify-between gap-3 pl-3.5 pr-1">
          <h3 className="m-0 text-[12px] font-normal leading-4 tracking-[0.01em] text-ink-secondary">{label}</h3>
          {action}
        </div>
      )}
      <div className={listCardCls}>{children}</div>
    </section>
  );
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

/**
 * Grok's centred dialog: the white sheet on a 1px 12% ink edge with 14px corners over a half-black scrim, a 55px header
 * with the title and a round close, a padded body and a hairline-topped footer. It is there at once and gone at once,
 * as Grok's kit dialog is. Focus stays inside; Escape closes it, unless a menu or dialog opened from it takes the key.
 */
export function ModalSheet({ title, leading, width = 440, onClose, footer, children, bodyClassName, ...rest }: {
  title: ReactNode;
  leading?: ReactNode;
  width?: number;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  "data-panel-modal": string;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = sheet.current;
    const first = root?.querySelector<HTMLElement>("[data-autofocus]") ?? root;
    first?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      const box = sheet.current;
      if (!box || (event.key !== "Escape" && event.key !== "Tab")) return;
      const target = event.target instanceof Element ? event.target : null;
      const nested = target?.closest('[role="dialog"], [role="alertdialog"]');
      if (nested && nested !== box) return;
      if (event.key === "Escape") {
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        close.current();
        return;
      }
      const controls = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0);
      const head = controls[0];
      const tail = controls.at(-1);
      if (!head || !tail) { event.preventDefault(); box.focus(); return; }
      if (!box.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? tail : head).focus(); return; }
      if (event.shiftKey && (document.activeElement === head || document.activeElement === box)) { event.preventDefault(); tail.focus(); }
      else if (!event.shiftKey && document.activeElement === tail) { event.preventDefault(); head.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div aria-hidden="true" data-modal-scrim className="ui-dialog-scrim absolute inset-0" onMouseDown={() => close.current()} />
      <div
        ref={sheet}
        {...rest}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        className="relative flex max-h-[calc(100dvh-32px)] flex-col overflow-hidden rounded-[14px] border border-ink/12 bg-menu text-[13px] font-[425] text-ink outline-none"
      >
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={() => close.current()}
          className="absolute right-2.5 top-2.5 z-[1] flex size-8 cursor-pointer items-center justify-center rounded-[9999px] text-ink/68 transition-[color,background-color] duration-150 ease-[ease] hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          <GrokIcon name="close" size={14} />
        </button>
        <div className="flex min-h-[55px] shrink-0 items-center gap-2.5 border-b border-ink/12 py-4 pl-4 pr-12">
          {leading}
          <h2 id={titleId} className="m-0 min-w-0 truncate text-[14px] font-semibold leading-[22px] tracking-[-0.15px]">{title}</h2>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 leading-[18px] tracking-[-0.08px] [scrollbar-width:thin]", bodyClassName)}>
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-ink/12 py-3 pl-4 pr-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
