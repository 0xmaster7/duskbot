import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import type { useBotSettingsDerived } from "../../bot-settings/useBotSettingsDerived";
import { DialogEmpty, DialogSection, DialogSkeleton, FilledField, footnoteCls, GrokDialog, listRowCls, RowIconButton, rowHintCls, rowTitleCls } from "../../ui/GrokDialog";
import { BotSwitch } from "../rows";
import { useMemoryEditor } from "./use-memory-editor";

/** What the bot remembers: memory on or off, its notes with a forget on each, and a line to add one. */
export function MemoryModal({ bot, derived, onClose }: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
  onClose: () => void;
}) {
  const { memoryOn, readError, notes, index, draft, setDraft, saving, error, forget, add } = useMemoryEditor(bot);
  const count = notes?.length ?? 0;
  const label = notes === null || count === 0 ? "Notes" : count === 1 ? t("botPanel.memory.note") : t("botPanel.memory.notes", { count });
  const editable = bot.yourAccess !== "view";

  return (
    <GrokDialog
      data-panel-modal="memory"
      title={t("botPanel.memoryRow")}
      description={`What ${bot.name} keeps in mind between chats.`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-7">
        <DialogSection>
          <div data-modal-row="memory-on" className={listRowCls}>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={rowTitleCls}>{t("memory.enable")}</span>
              <span className={rowHintCls}>{memoryOn ? `${bot.name} saves what matters and keeps it tidy.` : t("botPanel.library.memoryOff", { name: bot.name })}</span>
            </div>
            <BotSwitch
              color={bot.color}
              checked={memoryOn}
              disabled={Boolean(bot.busy) || !editable}
              aria-label={t("memory.enable")}
              onClick={() => derived.patch({ memoryEnabled: !memoryOn })}
            />
          </div>
        </DialogSection>

        {memoryOn && (
          <div className="flex flex-col gap-2.5">
            <DialogSection bare={!readError && notes !== null && notes.length === 0} label={label} data-modal-group="notes">
              {readError ? (
                <p role="alert" className={cn(listRowCls, rowHintCls, "m-0 text-warning")}>{t("botPanel.library.memoryError")}</p>
              ) : notes === null ? (
                <DialogSkeleton />
              ) : notes.length === 0 ? (
                <DialogEmpty>{t("botPanel.memory.empty")} Add a note below, or {bot.name} picks things up as you talk.</DialogEmpty>
              ) : (
                <ul aria-label={label} className="m-0 flex max-h-[min(300px,calc(100dvh-420px))] list-none flex-col overflow-y-auto p-0 [scrollbar-width:thin]">
                  {notes.map((note) => (
                    <li key={`${note.path}:${note.line}:${note.text}`} data-memory-note={note.line ?? note.path} className={cn("group/row", listRowCls, "min-h-11 gap-x-3 py-2 pr-2.5")}>
                      <span className={cn(rowTitleCls, "min-w-0 flex-1 text-pretty")}>{note.text}</span>
                      {editable && <RowIconButton reveal icon="trash" data-modal-action="forget" label={t("botPanel.memory.forget")} disabled={saving} onClick={() => forget(note)} />}
                    </li>
                  ))}
                </ul>
              )}
            </DialogSection>
            {editable && (
              <FilledField
                data-panel-form="memory-add"
                value={draft}
                placeholder={t("botPanel.memory.addPlaceholder", { name: bot.name })}
                label={t("botPanel.memory.addPlaceholder", { name: bot.name })}
                disabled={index === null}
                busy={saving}
                submitLabel={t("common.add")}
                onChange={setDraft}
                onSubmit={() => void add()}
              />
            )}
          </div>
        )}
        {error && <p role="alert" className={cn(footnoteCls, "-mt-4 text-warning")}>{error}</p>}
      </div>
    </GrokDialog>
  );
}
