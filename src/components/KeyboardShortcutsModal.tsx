import { useLayoutEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import {
  filterShortcutGroups,
  isMacPlatform,
  shortcutGroupsFor,
  shortcutKeysForPlatform,
  type ShortcutItem,
} from "@/lib/keyboard-shortcuts";
import { useSendKey } from "@/lib/send-key";

export interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

function ShortcutRow({ item, isMac }: { item: ShortcutItem; isMac: boolean }) {
  const keys = shortcutKeysForPlatform(item, isMac);

  return (
    <div className="flex min-h-[34px] items-center justify-between gap-4 px-3 py-1.5">
      <span className="text-[13px] leading-[18px] text-ink">{item.description}</span>
      <div className="flex shrink-0 items-center gap-1">
        {keys.map((key, index) => (
          <kbd
            key={index}
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-menu px-1 font-sans text-[12px] leading-4 text-ink-secondary shadow-[0_0_0_0.5px_var(--color-edge),0_1px_1px_rgb(28_28_28/0.04)]"
          >
            {key}
          </kbd>
        ))}
      </div>
    </div>
  );
}

export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isMac = isMacPlatform();
  const sendKey = useSendKey();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    setQuery("");
    dialog.showModal();
    inputRef.current?.focus();
    // Close before unmount so the browser restores focus to the opener.
    return () => dialog.close();
  }, [open]);

  if (!open) return null;

  const groups = filterShortcutGroups(shortcutGroupsFor(sendKey), query, isMac);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="shortcuts-dialog-title"
      className="ui-dialog m-auto w-[min(500px,calc(100%-32px))] max-h-[85vh] overflow-hidden p-0 backdrop:bg-black/50"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[85vh] flex-col"
      >
        <div className="flex items-center gap-2 py-3 pe-3 ps-4">
          <h2 id="shortcuts-dialog-title" className="ui-dialog-title min-w-0 flex-1">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="ui-icon-button size-7 min-h-7 shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 pb-2">
          <div className="flex h-8 items-center gap-2 rounded-lg bg-ink/[0.03] px-2.5 shadow-[inset_0_0_0_0.5px_var(--color-edge)] focus-within:shadow-[inset_0_0_0_1px_var(--color-focus)]">
            <Search size={14} className="shrink-0 text-ink-secondary" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search shortcuts…"
              aria-label="Search shortcuts"
              className="w-full bg-transparent text-[13px] leading-[18px] text-ink placeholder:text-ink-tertiary focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4 pt-1">
          {groups.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-ink-secondary">
              No shortcuts found for “{query}”
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.category}>
                <div className="px-2 pb-1.5 pt-2 text-[13px] leading-[18px] text-ink-secondary">
                  {group.category}
                </div>
                <div className="divide-y divide-[var(--color-edge)] rounded-xl bg-menu shadow-[0_0_0_0.5px_var(--color-edge)]">
                  {group.items.map((item) => (
                    <ShortcutRow key={item.id} item={item} isMac={isMac} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t-[0.5px] border-[var(--color-edge)] px-4 py-3 text-[12px] leading-4 text-ink-secondary">
          <span>
            Press <kbd className="rounded-[5px] px-1 py-0.5 font-sans text-[11px] shadow-[0_0_0_0.5px_var(--color-edge)]">?</kbd> when not typing to open
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ui-button ui-button-primary ui-button-md"
          >
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
