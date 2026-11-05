import { createContext, useContext, useEffect, useId, useRef, type FormEvent, type ReactNode, type Ref, type RefObject } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { GrokIcon, type GrokIconName } from "../GrokIcon";

const buttonBase = "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-[9999px] font-normal outline-none transition-[background-color,color] duration-[120ms] ease-[ease] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-default enabled:active:scale-[0.98] motion-reduce:enabled:active:scale-100";
const sizeLg = "h-9 px-4 text-[14px] leading-5 tracking-[0.01em]";
const sizeRow = "h-[30px] px-3 text-[13px] leading-[18px] tracking-[0.195px]";
const sizeSm = "h-6 px-2 text-[12px] leading-4 tracking-[0.01em]";
const primaryTone = "bg-ink text-app enabled:hover:bg-[color-mix(in_srgb,var(--color-ink)_88.5%,var(--color-menu))] disabled:bg-ink/15 disabled:text-ink/30";
const secondaryTone = "bg-ink/6 text-ink shadow-[inset_0_0_0_0.5px_color-mix(in_srgb,var(--color-ink)_6%,transparent)] enabled:hover:bg-ink/10 disabled:text-ink/30";

export const dialogPrimaryCls = cn(buttonBase, sizeLg, primaryTone);
export const dialogSecondaryCls = cn(buttonBase, sizeLg, secondaryTone);
export const rowButtonCls = cn(buttonBase, sizeRow, secondaryTone);
export const smallButtonCls = cn(buttonBase, sizeSm, secondaryTone);

export const rowTitleCls = "text-[13px] leading-[18px] tracking-[-0.08px] text-ink";
export const rowHintCls = "text-[13px] leading-[18px] tracking-[-0.08px] text-ink/68";
export const footnoteCls = "m-0 pl-2 text-[12px] leading-4 tracking-[0.01em] text-ink/56";
export const listCardCls = "flex flex-col rounded-[14px] bg-menu py-2 outline-1 -outline-offset-1 outline-ink/8 [outline-style:solid]";
export const listRowCls = "flex min-h-12 items-center gap-x-5 px-3.5 py-2.5";
export const textAreaCls = "block w-full resize-none rounded-[14px] border border-ink/8 bg-menu px-3.5 py-3 text-[14px] leading-[22px] tracking-[0.01em] text-ink outline-none transition-[border-color] duration-[120ms] ease-[ease] [scrollbar-width:thin] placeholder:text-ink/40 focus:border-ink/24! disabled:opacity-50";

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

/** Set by a sheet with a rail (the bot's settings): a dialog inside it draws as that sheet's pane instead of its own sheet. */
export const DialogPane = createContext(false);

/** Focus into the dialog on open and back to the opener on close, Escape to close, Tab kept inside. A nested dialog
 * handles its own keys. */
export function useDialogKeys(sheet: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = sheet.current;
    (root?.querySelector<HTMLElement>("[data-autofocus]") ?? root)?.focus({ preventScroll: true });
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
  }, [sheet]);

  return close;
}

/** Grok's settings-pane sheet: app-toned, 14px corners on a 1px ink/12 edge, a 17px title with no rule under it,
 * white list cards in the body and a borderless footer. It appears and goes at once, as Grok's app dialogs do. */
export function GrokDialog(props: DialogProps) {
  return useContext(DialogPane) ? <PaneView {...props} /> : <SheetView {...props} />;
}

interface DialogProps {
  title: ReactNode;
  description?: ReactNode;
  width?: number;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  "data-panel-modal"?: string;
}

const headerCls = "flex shrink-0 flex-col gap-1 pb-1.5 pl-8 pr-[54px] pt-8";
const titleCls = "m-0 min-w-0 truncate pl-2 text-[17px] font-medium leading-6 tracking-[0.01em]";

/** The same dialog as one pane of a railed sheet: Settings' header and scrolling body, the footer pinned under it. */
function PaneView({ title, description, footer, children, onClose: _onClose, width: _width, ...rest }: DialogProps) {
  const titleId = useId();
  return (
    <section {...rest} aria-labelledby={titleId} className="flex min-h-0 flex-1 flex-col">
      <header className={headerCls}>
        <h2 id={titleId} className={titleCls}>{title}</h2>
        {description && <p className={cn(rowHintCls, "m-0 pl-2 text-pretty")}>{description}</p>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-8 pb-7 pt-[22px] [scrollbar-width:none]">
        {children}
      </div>
      {footer && <div className="-mt-3 flex shrink-0 items-center justify-end gap-2 px-8 pb-6 pt-1">{footer}</div>}
    </section>
  );
}

function SheetView({ title, description, width = 540, onClose, footer, children, ...rest }: DialogProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const close = useDialogKeys(sheet, onClose);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div aria-hidden="true" data-modal-scrim className="ui-dialog-scrim absolute inset-0" onMouseDown={() => close.current()} />
      <div
        ref={sheet}
        {...rest}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        className="relative flex max-h-[calc(100dvh-32px)] flex-col overflow-hidden rounded-[14px] border border-ink/12 bg-app text-[13px] font-[425] text-ink outline-none"
      >
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={() => close.current()}
          className="absolute right-2.5 top-2.5 z-[1] flex size-8 cursor-pointer items-center justify-center rounded-[9999px] text-ink/56 transition-[color,background-color] duration-[120ms] ease-[ease] hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          <GrokIcon name="close" size={14} />
        </button>
        <header className={headerCls}>
          <h2 id={titleId} className={titleCls}>{title}</h2>
          {description && <p id={descriptionId} className={cn(rowHintCls, "m-0 pl-2 text-pretty")}>{description}</p>}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-8 pb-7 pt-[22px] [scrollbar-width:thin]">
          {children}
        </div>
        {footer && (
          <div className="-mt-3 flex shrink-0 items-center justify-end gap-2 px-8 pb-7 pt-1">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** A labelled section of a dialog: Grok's 12px label 14px in, 8px over its white card. */
export function DialogSection({ label, action, children, bare = false, ...rest }: {
  label?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  bare?: boolean;
  "data-modal-group"?: string;
}) {
  return (
    <section {...rest} className="flex flex-col gap-2">
      {(label || action) && (
        <div className="flex min-h-4 items-center justify-between gap-3 pl-3.5 pr-1">
          {label && <h3 className="m-0 text-[12px] font-normal leading-4 tracking-[0.01em] text-ink/68">{label}</h3>}
          {action}
        </div>
      )}
      {bare ? children : <div className={listCardCls}>{children}</div>}
    </section>
  );
}

/** Grok's empty line: one plain centred sentence that names the next step. */
export function DialogEmpty({ children }: { children: ReactNode }) {
  return <p data-modal-empty className={cn(rowHintCls, "m-0 px-6 py-5 text-center text-pretty")}>{children}</p>;
}

export function DialogSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-2.5 px-3.5 py-3.5">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className={cn("h-3 rounded-full bg-ink/6", index % 2 ? "w-1/2" : "w-3/4")} />
      ))}
    </div>
  );
}

/** Grok's filled field (the Vault and Connect Apps search): a 32px pill tinted ink/4 that darkens its edge on focus,
 * with a leading glyph and an Add that wakes once there is something to add. */
export function FilledField({ icon = "plus", value, placeholder, label, disabled, busy, submitLabel, onChange, onSubmit, inputRef, ...rest }: {
  icon?: GrokIconName;
  value: string;
  placeholder: string;
  label: string;
  disabled?: boolean;
  busy?: boolean;
  submitLabel: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  inputRef?: Ref<HTMLInputElement>;
  "data-panel-form"?: string;
}) {
  const ready = Boolean(value.trim()) && !disabled && !busy;
  return (
    <form
      {...rest}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (ready) onSubmit();
      }}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-[9999px] border border-ink/12 bg-ink/4 pl-[11px] pr-1 transition-[border-color] duration-[120ms] ease-[ease] focus-within:border-ink/24",
        disabled && "opacity-50",
      )}
    >
      <span aria-hidden="true" className="flex shrink-0 text-ink/56"><GrokIcon name={icon} size={14} /></span>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled || busy}
        onChange={(event) => onChange(event.target.value)}
        className="h-5 min-w-0 flex-1 bg-transparent text-[13px] leading-[18px] tracking-[0.195px] text-ink outline-none placeholder:text-ink/56"
      />
      <button type="submit" disabled={!ready} className={cn(smallButtonCls, "disabled:bg-transparent disabled:shadow-none")}>{submitLabel}</button>
    </form>
  );
}

/** A small action on a row, shown on hover, on touch and whenever the row holds focus. */
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
        "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-ink/66 transition-[background-color,color,opacity] duration-[120ms] ease-[ease] enabled:hover:bg-ink/6 enabled:hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus disabled:cursor-default disabled:text-ink/24",
        reveal && "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 touch:opacity-100",
      )}
    >
      <GrokIcon name={icon} size={14} />
    </button>
  );
}

/** A row that opens something elsewhere: a glyph, the name over a line, a chevron. */
export function DialogLinkRow({ icon, title, hint, onClick, ...rest }: {
  icon: GrokIconName;
  title: string;
  hint: string;
  onClick: () => void;
  "data-panel-link"?: string;
}) {
  return (
    <button
      type="button"
      {...rest}
      onClick={onClick}
      className="mx-1.5 flex min-h-12 cursor-pointer items-center gap-3 rounded-[10px] px-2 py-2 text-left transition-[background-color] duration-[120ms] ease-[ease] hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
    >
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-ink/5 text-ink/80">
        <GrokIcon name={icon} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={rowTitleCls}>{title}</span>
        <span className={cn(rowHintCls, "truncate")}>{hint}</span>
      </span>
      <span aria-hidden="true" className="flex shrink-0 text-ink/40"><GrokIcon name="chevron-right" size={14} /></span>
    </button>
  );
}

/** One choice of several as a row of a list card: a glyph, the name over a line, and a check on the chosen one.
 * Arrow keys move between the rows of one radiogroup. */
export function DialogChoice({ icon, title, hint, checked, disabled, onSelect, children, ...rest }: {
  icon: GrokIconName;
  title: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children?: ReactNode;
  "data-panel-choice"?: string;
}) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        role="radio"
        {...rest}
        aria-checked={checked}
        disabled={disabled}
        tabIndex={checked ? 0 : -1}
        onClick={onSelect}
        onKeyDown={(event) => {
          const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"];
          if (!keys.includes(event.key)) return;
          const group = event.currentTarget.closest('[role="radiogroup"]');
          const radios = [...(group?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? [])];
          const at = radios.indexOf(event.currentTarget);
          if (at < 0) return;
          event.preventDefault();
          const step = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
          const next = radios[(at + step + radios.length) % radios.length];
          next?.focus();
          next?.click();
        }}
        className={cn(
          "mx-1.5 flex min-h-[60px] cursor-pointer items-center gap-3 rounded-[10px] px-2 py-2.5 text-left outline-none transition-[background-color] duration-[120ms] ease-[ease] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus disabled:cursor-not-allowed",
          !disabled && "hover:bg-ink/5",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-[9px] transition-colors duration-[120ms] ease-[ease]",
            checked ? "bg-ink text-app" : "bg-ink/5 text-ink/80",
            disabled && !checked && "opacity-50",
          )}
        >
          <GrokIcon name={icon} size={16} />
        </span>
        <span className={cn("flex min-w-0 flex-1 flex-col gap-0.5", disabled && !checked && "opacity-50")}>
          <span className={cn(rowTitleCls, checked && "font-medium")}>{title}</span>
          {hint && <span className={cn(rowHintCls, "text-pretty")}>{hint}</span>}
        </span>
        <span aria-hidden="true" className={cn("flex w-4 shrink-0 justify-center text-ink", !checked && "invisible")}>
          <GrokIcon name="check" size={14} />
        </span>
      </button>
      {children}
    </div>
  );
}
