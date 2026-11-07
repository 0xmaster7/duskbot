import {
  isMacPlatform,
  shortcutGroupsFor,
  shortcutKeysForPlatform,
  type ShortcutItem,
} from "@/lib/keyboard-shortcuts";
import { useSendKey } from "@/lib/send-key";
import { GrokDialog } from "./ui/GrokDialog";

export interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

function ShortcutRow({ item, isMac }: { item: ShortcutItem; isMac: boolean }) {
  const keys = shortcutKeysForPlatform(item, isMac);

  return (
    <div className="flex min-h-[35px] items-center justify-between gap-4 border-b border-ink/8 py-1.5 last:border-b-0">
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

/** Grok's Keyboard shortcuts: every group at once in two columns, nothing to search and no footer. */
export function KeyboardShortcutsModal({ open, onClose }: KeyboardShortcutsModalProps) {
  const isMac = isMacPlatform();
  const sendKey = useSendKey();
  if (!open) return null;
  const groups = shortcutGroupsFor(sendKey);
  return (
    <GrokDialog data-panel-modal="shortcuts" title="Keyboard shortcuts" width={900} onClose={onClose}>
      <div className="grid grid-cols-1 gap-x-16 gap-y-5 pb-2 md:grid-cols-2">
        {groups.map((group) => (
          <section key={group.category} aria-label={group.category} className="min-w-0">
            <h3 className="m-0 pb-1 text-[13px] font-medium leading-[18px] text-ink">{group.category}</h3>
            {group.items.map((item) => <ShortcutRow key={item.id} item={item} isMac={isMac} />)}
          </section>
        ))}
      </div>
    </GrokDialog>
  );
}
