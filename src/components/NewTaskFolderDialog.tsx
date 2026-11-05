import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { fieldLabelCls, formBodyCls, formCloseCls, formFooterCls, formHeaderCls, formSheetCls, formTitleCls, mdPrimaryCls, mdSecondaryCls, rowHintCls, textFieldCls } from "./ui/GrokDialog";

/** A pin is chosen while creating a thread, never by moving the working directory of an existing provider session. */
export function NewTaskFolderDialog({ bot, onClose, onReturnFocus }: { bot: Bot; onClose: () => void; onReturnFocus?: () => void }) {
  const { dispatch } = useStore();
  const [cwd, setCwd] = useState(bot.cwd ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = () => { if (!pending.current) onClose(); };
  useModalDialog(dialog, close);
  const returnFocus = useRef(onReturnFocus);
  returnFocus.current = onReturnFocus;
  useEffect(() => () => { returnFocus.current?.(); }, []);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (saving) dialog.current?.focus();
    else if (error) input.current?.focus();
  }, [saving, error]);

  return createPortal(<div data-thread-overlay className="fixed inset-0 z-50 flex items-center justify-center p-4"
    onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div aria-hidden="true" className="ui-dialog-scrim pointer-events-none absolute inset-0" />
    <div ref={dialog} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="new-task-folder-title" aria-busy={saving || undefined}
      className={cn(formSheetCls, "max-w-[440px] focus-visible:outline-none!")}>
      <header className={formHeaderCls}>
        <h2 id="new-task-folder-title" className={formTitleCls}>{t("task.folder.new")}</h2>
        <button type="button" aria-label={t("common.close")} disabled={saving} onClick={close} className={formCloseCls}><X size={16} aria-hidden="true" /></button>
      </header>
      <form className="contents" onSubmit={(event) => {
        event.preventDefault();
        if (!cwd.trim() || pending.current) return;
        pending.current = true;
        setSaving(true);
        setError(null);
        const currentProject = bot.tasks?.find((task) => task.threadId === bot.threadId)?.projectId;
        const projectId = bot.projects?.find((project) => project.id === currentProject)?.id;
        dispatch({ type: "newTask", botId: bot.id, projectId, cwd: cwd.trim(), onCreated: onClose,
          onError: (message) => { pending.current = false; setSaving(false); setError(message); } });
      }}>
        <div className={cn(formBodyCls, "flex flex-col gap-3")}>
          <p id="new-task-folder-description" className={cn(rowHintCls, "m-0 text-pretty")}>{t("task.folder.detail")}</p>
          <label className="flex flex-col gap-1">
            <span className={fieldLabelCls}>{t("task.folder.path")}</span>
            <input ref={input} value={cwd} disabled={saving} aria-describedby="new-task-folder-description" autoComplete="off" spellCheck={false}
              onChange={(event) => { setCwd(event.target.value); setError(null); }} placeholder={t("task.folder.placeholder")}
              className={cn(textFieldCls, "font-mono tracking-normal")} />
          </label>
          {error && <p role="alert" className="m-0 text-[12px] leading-4 text-danger">{error}</p>}
        </div>
        <div className={formFooterCls}>
          <button type="button" disabled={saving} onClick={close} className={mdSecondaryCls}>{t("common.cancel")}</button>
          <button type="submit" disabled={saving || !cwd.trim()} className={mdPrimaryCls}>{t(saving ? "task.folder.creating" : "task.newShort")}</button>
        </div>
      </form>
    </div>
  </div>, document.body);
}
