import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { GrokIcon } from "./GrokIcon";
import { formCloseCls, formFooterCls, formHeaderCls, formSheetCls, formTitleCls, mdPrimaryCls, mdSecondaryCls } from "./ui/GrokDialog";
import { useStore, type Group } from "@/state/store";
import { BotPickerList } from "./BotPickerList";
import { nextMemberIds } from "@/lib/room-members";

export function ManageMembersPanel({
  group,
  onClose,
  triggerRef,
}: {
  group: Group;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const { state, dispatch } = useStore();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(group.memberIds));
  const [saveError, setSaveError] = useState<string | null>(null);
  const openedMemberIds = useRef([...group.memberIds]);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Archived bots stay listed while still members, or a room could keep a member you cannot remove.
  const bots = useMemo(
    () => state.bots.filter((b) => !b.hidden || group.memberIds.includes(b.id)),
    [state.bots, group.memberIds],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = () =>
      [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
        (element) => !element.hasAttribute("hidden"),
      );
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) return event.preventDefault();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKey);
    return () => {
      dialog.removeEventListener("keydown", onKey);
      triggerRef.current?.focus();
    };
  }, [onClose, triggerRef]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const memberIds = nextMemberIds(
    group.memberIds,
    picked,
    bots.map((b) => b.id),
  );
  const changed = memberIds.length !== group.memberIds.length || memberIds.some((id, i) => id !== group.memberIds[i]);

  const save = () => {
    if (!memberIds.length) return;
    const opened = openedMemberIds.current;
    const rosterChanged =
      opened.length !== group.memberIds.length || opened.some((id, index) => id !== group.memberIds[index]);
    if (rosterChanged) {
      setSaveError(t("sheet.rows.members.changed"));
      return;
    }
    if (changed) {
      dispatch({ type: "patchGroup", groupId: group.id, patch: { memberIds } });
      track("room_members_changed", {
        members: memberIds.length,
        added: memberIds.filter((id) => !group.memberIds.includes(id)).length,
        removed: group.memberIds.filter((id) => !memberIds.includes(id)).length,
      });
    }
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div aria-hidden="true" data-modal-scrim className="ui-dialog-scrim absolute inset-0" onMouseDown={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Manage members of ${group.name}`}
        style={{ maxWidth: "min(360px, calc(100vw - 32px))" }}
        className={formSheetCls}
      >
        <header className={formHeaderCls}>
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className={formTitleCls}>{t("room.members.manage")}</h2>
            <p className="m-0 truncate text-[13px] leading-[18px] tracking-[0.015em] text-ink-secondary">{group.name}</p>
          </div>
          <button type="button" aria-label={t("common.close")} onClick={onClose} className={formCloseCls}>
            <GrokIcon name="close" size={16} />
          </button>
        </header>
        <div className="flex min-h-0 flex-col px-3 pb-1">
          <BotPickerList bots={bots} picked={picked} onToggle={toggle} emptyHint={t("sheet.rows.members.empty")} />
        </div>
        {(!memberIds.length || saveError) && (
          <p role={saveError ? "alert" : undefined} className={cn("m-0 px-4 pt-1 text-[12px] leading-4 tracking-[0.01em]", saveError ? "text-danger" : "text-ink-secondary")}>
            {saveError ?? t("sheet.rows.members.needOne")}
          </p>
        )}
        <div className={formFooterCls}>
          <button type="button" onClick={onClose} className={mdSecondaryCls}>{t("common.cancel")}</button>
          <button type="button" onClick={save} disabled={!memberIds.length} className={mdPrimaryCls}>{t("sheet.rows.members.save")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
