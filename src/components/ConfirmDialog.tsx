import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { mdDangerCls, mdPrimaryCls, mdSecondaryCls } from "./ui/GrokDialog";

export type ConfirmTone = "danger" | "neutral";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** The way out, "Cancel" unless given. */
  cancelLabel?: string;
  tone?: ConfirmTone;
  icon?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  /** A gentler way to the same end, offered beside the confirm button ("Archive instead"). */
  alternative?: { label: string; onClick: () => void };
  pending?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Where it sits among open dialogs, when another one above the usual layer asked it. */
  layer?: string;
}

/**
 * Cancel is focused by default so a stray Enter never confirms. Portalled to <body>: the sidebar's translate below md
 * would become the containing block.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, onCancel, returnFocusRef } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancelAction = useRef(onCancel);
  cancelAction.current = onCancel;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelAction.current();
        return;
      }
      if (event.key === "Tab") {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
        if (!controls?.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
        const first = controls[0]!;
        const last = controls[controls.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const target = opener?.isConnected && opener !== document.body ? opener : returnFocusRef?.current;
      target?.focus();
    };
  }, [open, returnFocusRef]);

  // Capture the opener above before moving focus on open or pending changes.
  useEffect(() => {
    if (!open) return;
    if (props.pending) dialogRef.current?.focus();
    else cancelRef.current?.focus();
  }, [open, props.pending]);

  if (!open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${props.layer ?? "z-50"} flex items-center justify-center p-6`}
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <div aria-hidden="true" className="ui-dialog-scrim pointer-events-none absolute inset-0" />
      <ConfirmDialogCard ref={dialogRef} cancelRef={cancelRef} {...props} />
    </div>,
    document.body,
  );
}

export function ConfirmDialogCard({
  ref,
  cancelRef,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  icon,
  onCancel,
  onConfirm,
  alternative,
  pending = false,
}: ConfirmDialogProps & {
  ref?: React.Ref<HTMLDivElement>;
  cancelRef?: React.Ref<HTMLButtonElement>;
}) {
  const danger = tone === "danger";
  return (
    <div
      ref={ref}
      role="alertdialog"
      tabIndex={-1}
      aria-modal="true"
      aria-busy={pending}
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-body"
      data-tone={tone}
      className="ui-dialog relative flex w-full max-w-[320px] flex-col outline-none"
    >
      <div className="flex flex-col gap-1 px-4 py-3">
        <h2 id="confirm-dialog-title" className="m-0 flex items-center gap-2 text-[14px] font-semibold leading-[22px] tracking-[-0.15px] text-ink">
          {icon && <span aria-hidden="true" className="flex shrink-0 text-ink/56">{icon}</span>}
          <span className="min-w-0">{title}</span>
        </h2>
        <div id="confirm-dialog-body" className="text-[14px] leading-[22px] tracking-[-0.15px] text-ink/56 text-pretty">
          {body}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 py-3 pl-4 pr-3">
        <button ref={cancelRef} type="button" onClick={onCancel} disabled={pending} className={`${mdSecondaryCls} flex-1`}>
          {cancelLabel}
        </button>
        {alternative && <button type="button" data-confirm-alternative onClick={alternative.onClick} disabled={pending}
          className={`${mdSecondaryCls} flex-1`}>{alternative.label}</button>}
        <button type="button" onClick={onConfirm} disabled={pending} className={`${danger ? mdDangerCls : mdPrimaryCls} flex-1`}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
